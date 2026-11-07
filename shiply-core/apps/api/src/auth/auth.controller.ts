import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyPassword } from '@shiply/db';
import { normalizeEgyptPhone, type Role } from '@shiply/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { CurrentUser, Public, SESSION_COOKIE, type SessionUser } from './auth';

const SESSION_HOURS = 12;
// Sign in with an email, or with a phone number (couriers and agents usually have no email).
const LoginBody = z
  .object({ login: z.string().trim().max(200).optional(), email: z.string().trim().max(200).optional(), password: z.string().min(1).max(200) })
  .refine((b) => !!(b.login || b.email), { message: 'Enter your email or phone' });

// A real hash of a random value, so unknown emails take as long as wrong passwords.
const DUMMY_HASH =
  'scrypt$c2hpcGx5c2hpcGx5c2hpcGx5$9YbqOxDJx7O4nbOKQ6cWnVUAP8iL7bH6O2Y3mB6Kq8w1x1n2R6QG3gVwA7m3U2xG7q1y0Rr1x4w1s2e3d4f5gQ==';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parse(LoginBody, body);
    const id = (b.login || b.email || '').trim();
    let candidates: { id: string; name: string; role: Role; active: boolean; passwordHash: string }[] = [];
    if (id.includes('@')) {
      const u = await this.prisma.user.findUnique({ where: { email: id.toLowerCase() } });
      if (u) candidates = [u];
    } else {
      const phone = normalizeEgyptPhone(id);
      if (phone) candidates = await this.prisma.user.findMany({ where: { phone }, orderBy: { createdAt: 'asc' }, take: 5 });
    }
    let user: (typeof candidates)[number] | null = null;
    for (const c of candidates) if (!user && (await verifyPassword(b.password, c.passwordHash))) user = c;
    if (candidates.length === 0) await verifyPassword(b.password, DUMMY_HASH);
    if (!user || !user.active) throw new DomainError('bad_login', 'Wrong email, phone or password', 401);
    const token = await this.jwt.signAsync({ sub: user.id }, { expiresIn: `${SESSION_HOURS}h` });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_HOURS * 3600 * 1000,
      path: '/',
    });
    return { id: user.id, name: user.name, role: user.role };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    const [hub, merchant, agent] = await Promise.all([
      user.hubId ? this.prisma.hub.findUnique({ where: { id: user.hubId } }) : null,
      user.merchantId ? this.prisma.merchant.findUnique({ where: { id: user.merchantId } }) : null,
      user.agentId ? this.prisma.agent.findUnique({ where: { id: user.agentId } }) : null,
    ]);
    return {
      ...user,
      hub: hub && { id: hub.id, code: hub.code, name: hub.name, isSorting: hub.isSorting },
      merchant: merchant && { id: merchant.id, code: merchant.code, name: merchant.name },
      agent: agent && { id: agent.id, code: agent.code, name: agent.name },
    };
  }
}
