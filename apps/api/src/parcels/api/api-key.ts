// API keys: "Authorization: Bearer shp_live_..." (or the X-Api-Key header). A key belongs to one
// merchant and is LIVE or TEST. Each key may make a fixed number of calls a minute.
import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export interface ApiCaller {
  keyId: string;
  merchantId: string;
  mode: 'LIVE' | 'TEST';
  /** The person who made the key; parcel events are recorded under them. */
  userId: string;
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function newKey(mode: 'LIVE' | 'TEST') {
  const key = `shp_${mode === 'LIVE' ? 'live' : 'test'}_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 14), hash: hashKey(key) };
}

const PER_MINUTE = Number(process.env.API_RATE_PER_MINUTE ?? 300);
const windows = new Map<string, { start: number; count: number }>();

function rateLimit(keyId: string, res: Response) {
  const now = Date.now();
  const w = windows.get(keyId);
  if (!w || now - w.start >= 60_000) {
    windows.set(keyId, { start: now, count: 1 });
    res.setHeader('X-RateLimit-Remaining', String(PER_MINUTE - 1));
    return;
  }
  w.count++;
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, PER_MINUTE - w.count)));
  if (w.count > PER_MINUTE) {
    res.setHeader('Retry-After', String(Math.ceil((w.start + 60_000 - now) / 1000)));
    throw new DomainError('rate_limited', `Too many calls. At most ${PER_MINUTE} a minute`, 429);
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { api?: ApiCaller }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = req.headers.authorization ?? '';
    const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-api-key'] ?? '').trim();
    if (!raw.startsWith('shp_')) throw new DomainError('unauthenticated', 'Send your API key as "Authorization: Bearer shp_..."', 401);
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
    if (!key || key.revokedAt) throw new DomainError('unauthenticated', 'This API key is not valid', 401);
    const m = await this.prisma.merchant.findUnique({ where: { id: key.merchantId }, select: { active: true, status: true } });
    if (!m?.active || m.status !== 'ACTIVE') throw new DomainError('forbidden', 'This merchant account is not active', 403);
    rateLimit(key.id, res);
    // Updating the last use at most once a minute keeps busy keys from writing on every call.
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    }
    req.api = { keyId: key.id, merchantId: key.merchantId, mode: key.mode as 'LIVE' | 'TEST', userId: key.createdById };
    return true;
  }
}

export const Caller = createParamDecorator((_: unknown, ctx: ExecutionContext): ApiCaller => {
  return ctx.switchToHttp().getRequest<Request & { api: ApiCaller }>().api;
});
