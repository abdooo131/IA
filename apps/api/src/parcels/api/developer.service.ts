// What a merchant manages in the Developers page: API keys and webhooks, with a log of calls.
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { assertMerchantRight, type SessionUser } from '../auth/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { checkWebhookUrl, sendDelivery, WEBHOOK_EVENTS } from '../common/webhooks';
import { newKey } from './api-key';

const KeyInput = z.object({ name: z.string().trim().min(2, 'Name the key, for example "Shopify"').max(60), mode: z.enum(['LIVE', 'TEST']) });
const HookInput = z.object({
  url: z.string().trim().max(500),
  mode: z.enum(['LIVE', 'TEST']).default('LIVE'),
  events: z.array(z.enum(['*', ...WEBHOOK_EVENTS])).min(1, 'Pick at least one event'),
  active: z.boolean().default(true),
});
const MAX_KEYS = 10;
const MAX_HOOKS = 5;

@Injectable()
export class DeveloperService {
  constructor(private readonly prisma: PrismaService) {}

  /** Only the account owner, or someone with the settings right, handles keys and webhooks. */
  private merchant(user: SessionUser) {
    assertMerchantRight(user, 'settings');
    return user.merchantId!;
  }

  keys(user: SessionUser) {
    return this.prisma.apiKey.findMany({ where: { merchantId: this.merchant(user) }, omit: { keyHash: true }, orderBy: { createdAt: 'desc' } });
  }

  /** The full key is returned this once only. */
  async createKey(user: SessionUser, body: unknown) {
    const merchantId = this.merchant(user);
    const d = parse(KeyInput, body);
    if ((await this.prisma.apiKey.count({ where: { merchantId, revokedAt: null } })) >= MAX_KEYS) throw new DomainError('limit', `At most ${MAX_KEYS} keys. Revoke one you no longer use`, 409);
    const k = newKey(d.mode);
    const row = await this.prisma.apiKey.create({ data: { merchantId, name: d.name, mode: d.mode, prefix: k.prefix, keyHash: k.hash, createdById: user.id }, omit: { keyHash: true } });
    await this.prisma.auditLog.create({ data: { actorUserId: user.id, action: 'API_KEY_CREATED', entityType: 'api_key', entityId: row.id, after: { mode: d.mode, name: d.name } } });
    return { ...row, key: k.key };
  }

  async revokeKey(user: SessionUser, id: string) {
    const r = await this.prisma.apiKey.updateMany({ where: { id, merchantId: this.merchant(user), revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw notFound('Key');
    await this.prisma.auditLog.create({ data: { actorUserId: user.id, action: 'API_KEY_REVOKED', entityType: 'api_key', entityId: id } });
    return { message: 'Revoked. Calls with this key stop working now' };
  }

  async hooks(user: SessionUser) {
    const merchantId = this.merchant(user);
    const rows = await this.prisma.webhook.findMany({ where: { merchantId }, orderBy: { createdAt: 'asc' } });
    // The secret is shown again only by asking for it on one webhook.
    return rows.map(({ secret, ...h }) => ({ ...h, secretEnd: secret.slice(-4) }));
  }

  async saveHook(user: SessionUser, id: string | null, body: unknown) {
    const merchantId = this.merchant(user);
    const d = parse(HookInput, body);
    const url = checkWebhookUrl(d.url);
    if (id) {
      const r = await this.prisma.webhook.updateMany({ where: { id, merchantId }, data: { url, mode: d.mode, events: d.events, active: d.active, ...(d.active ? { failures: 0 } : {}) } });
      if (r.count !== 1) throw notFound('Webhook');
      return { message: 'Saved' };
    }
    if ((await this.prisma.webhook.count({ where: { merchantId } })) >= MAX_HOOKS) throw new DomainError('limit', `At most ${MAX_HOOKS} webhooks`, 409);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const h = await this.prisma.webhook.create({ data: { merchantId, url, mode: d.mode, events: d.events, active: d.active, secret } });
    return { id: h.id, secret, message: 'Saved. Keep the signing secret to check our calls' };
  }

  async hookSecret(user: SessionUser, id: string) {
    const h = await this.prisma.webhook.findFirst({ where: { id, merchantId: this.merchant(user) } });
    if (!h) throw notFound('Webhook');
    return { secret: h.secret };
  }

  async deleteHook(user: SessionUser, id: string) {
    const r = await this.prisma.webhook.deleteMany({ where: { id, merchantId: this.merchant(user) } });
    if (r.count !== 1) throw notFound('Webhook');
    return { message: 'Deleted' };
  }

  /** Sends a ping now, so the merchant sees whether their server answers. */
  async pingHook(user: SessionUser, id: string) {
    const h = await this.prisma.webhook.findFirst({ where: { id, merchantId: this.merchant(user) } });
    if (!h) throw notFound('Webhook');
    const d = await this.prisma.webhookDelivery.create({ data: { webhookId: h.id, event: 'ping', payload: { event: 'ping', at: new Date().toISOString(), mode: h.mode, data: { message: 'Hello from Shiply' } } } });
    const ok = await sendDelivery(this.prisma, d.id);
    const after = await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    // A failed ping is not worth retrying.
    if (!ok) await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED' } });
    return { ok, responseCode: after.responseCode, responseBody: after.responseBody };
  }

  async deliveries(user: SessionUser, id: string) {
    const h = await this.prisma.webhook.findFirst({ where: { id, merchantId: this.merchant(user) }, select: { id: true } });
    if (!h) throw notFound('Webhook');
    return this.prisma.webhookDelivery.findMany({ where: { webhookId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** Sends a failed or waiting delivery again now. */
  async retry(user: SessionUser, deliveryId: string) {
    const d = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: { select: { merchantId: true } } } });
    if (!d || d.webhook.merchantId !== this.merchant(user)) throw notFound('Delivery');
    if (d.status === 'SENT') throw new DomainError('bad_status', 'This one was already delivered', 409);
    await this.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'PENDING', nextAttemptAt: new Date() } });
    const ok = await sendDelivery(this.prisma, deliveryId);
    return { ok };
  }
}
