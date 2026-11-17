import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createMerchant,
  createSku,
  decideSignUp,
  DomainError,
  merchantOwed,
  versionInForce,
  importSkus,
  listAccountManagers,
  setAccountManager,
  type SkuImportResult,
  updateMerchant,
  updateSku,
} from '@shiplynow/db';
import {
  type AccessProfile,
  accountManagerSchema,
  type AccessTokenClaims,
  bulkIdsSchema,
  cairoDay,
  canDo,
  contractVersionLabel,
  type DocSmartButton,
  type MerchantBody,
  merchantSchema,
  type SkuBody,
  type SkuImportRow,
  skuImportRowSchema,
  skuImportSchema,
  skuSchema,
  type UpdateSkuBody,
  updateSkuSchema,
} from '@shiplynow/shared';
import { z } from 'zod';
import { assertMerchant } from '../auth/access-scope';
import { eachRecord } from '../common/bulk';
import { Clock } from '../common/clock';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const rejectSchema = z.object({ reason: z.string().trim().min(2).max(300) });

@ApiTags('admin')
@ApiBearerAuth()
@Access('merchants')
@Controller('admin')
export class AdminMerchantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Post('merchants')
  async createMerchant(
    @Body(new ZodValidationPipe(merchantSchema)) body: MerchantBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const merchant = await createMerchant(this.prisma, { ...body, actorUserId: user.sub });
    // An account manager looks after the merchants they open.
    if (access.ownMerchantsOnly)
      await setAccountManager(this.prisma, {
        merchantId: merchant.id,
        userId: user.sub,
        actorUserId: user.sub,
      });
    return { id: merchant.id };
  }

  /** Team members who can be picked as a merchant's account manager (merchants access). */
  @Get('account-managers')
  accountManagers() {
    return listAccountManagers(this.prisma);
  }

  /** Gives the merchant its account manager, or none (docs/HR.md 5). */
  @Put('merchants/:id/account-manager')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  accountManager(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(accountManagerSchema)) body: { userId: string | null },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setAccountManager(this.prisma, {
      merchantId: id,
      userId: body.userId,
      actorUserId: user.sub,
    });
  }

  @Patch('merchants/:id')
  @Access('merchants', undefined, { merchantParam: 'id' })
  async updateMerchant(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(merchantSchema.partial())) body: Partial<MerchantBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await updateMerchant(this.prisma, { ...body, merchantId: id, actorUserId: user.sub });
    return { id };
  }

  /** A self sign up: approve opens the account, reject needs a reason. */
  @Post('merchants/:id/approve')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  approve(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return decideSignUp(this.prisma, { merchantId: id, approve: true, actorUserId: user.sub });
  }

  @Post('merchants/:id/reject')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return decideSignUp(this.prisma, {
      merchantId: id,
      approve: false,
      reason: body.reason,
      actorUserId: user.sub,
    });
  }

  // ─── list view bulk actions and the document frame (UX phase C step 3) ───

  /** Approves several sign ups, each as the single approve (only pending ones). */
  @Post('merchants/bulk-approve')
  @Access('merchants', 'manage')
  bulkApprove(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return eachRecord(body.ids, async (id) => {
      assertMerchant(access, id);
      await decideSignUp(this.prisma, { merchantId: id, approve: true, actorUserId: user.sub });
    });
  }

  /** Pauses several approved merchants (as Pause on each), audited one by one. */
  @Post('merchants/bulk-pause')
  bulkPause(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return this.setActive(body.ids, false, user.sub, access);
  }

  /** Opens several paused, approved merchants again (as Resume on each). */
  @Post('merchants/bulk-activate')
  bulkActivate(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return this.setActive(body.ids, true, user.sub, access);
  }

  private setActive(ids: string[], isActive: boolean, actorUserId: string, access: AccessProfile) {
    return eachRecord(ids, async (id) => {
      assertMerchant(access, id);
      const m = await this.prisma.merchant.findUnique({
        where: { id },
        select: { approval: true, isActive: true },
      });
      if (!m) throw new DomainError('merchant_not_found', 404);
      // A sign up opens through approval, never by switching it on.
      if (m.approval !== 'approved') throw new DomainError('not_approved');
      if (m.isActive === isActive)
        throw new DomainError(isActive ? 'already_active' : 'already_paused');
      await updateMerchant(this.prisma, { merchantId: id, isActive, actorUserId });
    });
  }

  /**
   * The merchant page's document frame: smart buttons with counts of what the reader may open
   * (orders, products, shipments, returns, payouts, invoices, users), the contract version in
   * force and, for Accounting, the wallet balance (what we owe; below 0 the merchant owes us).
   */
  @Get('merchants/:id/document')
  @Access('merchants', 'view', { merchantParam: 'id' })
  async document(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    const m = await this.prisma.merchant.findUnique({
      where: { id },
      select: {
        name: true,
        _count: {
          select: {
            orders: true,
            skus: true,
            inboundManifests: true,
            merchantReturns: true,
            payouts: true,
            taxInvoices: true,
            users: true,
          },
        },
      },
    });
    if (!m) throw new NotFoundException({ error: 'merchant_not_found' });
    const today = cairoDay(this.clock.now());
    const version = await versionInForce(this.prisma, id, today);
    const ended = version?.endDate && version.endDate.toISOString().slice(0, 10) < today;
    const contract =
      version && !ended ? contractVersionLabel(version.contract.number, version.version) : null;
    const byMerchant = `f=&v=merchant:${id}`;
    const byName = `f=&q=${encodeURIComponent(m.name)}`;
    const smart: DocSmartButton[] = [];
    if (canDo(access, 'operations', 'view'))
      smart.push({ key: 'orders', count: m._count.orders, href: `/admin/orders?${byMerchant}` });
    smart.push({ key: 'products', count: m._count.skus, href: `/admin/products?${byMerchant}` });
    if (canDo(access, 'inventory', 'view'))
      smart.push(
        {
          key: 'shipments',
          count: m._count.inboundManifests,
          href: `/admin/shipments?${byMerchant}`,
        },
        { key: 'returns', count: m._count.merchantReturns, href: `/admin/returns?${byMerchant}` },
      );
    const accounting = canDo(access, 'accounting', 'view');
    if (accounting)
      smart.push(
        { key: 'payouts', count: m._count.payouts, href: `/finance/payouts?${byName}` },
        { key: 'invoices', count: m._count.taxInvoices, href: `/finance/invoices?${byName}` },
      );
    smart.push(
      {
        key: 'contract',
        count: null,
        value: contract ?? '–',
        href: `/admin/merchants/${id}?tab=contract`,
      },
      { key: 'users', count: m._count.users, href: `/admin/merchants/${id}?tab=users` },
    );
    return {
      smart,
      contract,
      balancePiastres: accounting ? await merchantOwed(this.prisma, id) : null,
    };
  }

  @Post('skus')
  async createSku(
    @Body(new ZodValidationPipe(skuSchema)) body: SkuBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    assertMerchant(access, body.merchantId);
    const sku = await createSku(this.prisma, { ...body, actorUserId: user.sub });
    return { id: sku.id };
  }

  @Patch('skus/:id')
  async updateSku(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSkuSchema)) body: UpdateSkuBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (access.ownMerchantsOnly) {
      const sku = await this.prisma.sku.findUnique({ where: { id }, select: { merchantId: true } });
      if (sku) assertMerchant(access, sku.merchantId);
    }
    await updateSku(this.prisma, { ...body, skuId: id, actorUserId: user.sub });
    return { id };
  }

  /**
   * Rows come from a CSV the browser has already split into objects keyed by header.
   * Every row is checked; with any error nothing is written and every error is listed.
   */
  @Post('skus/import')
  async importSkus(
    @Body(new ZodValidationPipe(skuImportSchema)) body: z.infer<typeof skuImportSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ): Promise<SkuImportResult> {
    assertMerchant(access, body.merchantId);
    const rows: { row: number; data: SkuImportRow }[] = [];
    const errors: SkuImportResult['errors'] = [];
    body.rows.forEach((raw, index) => {
      // Row 1 of the file is the header, so data starts on row 2.
      const row = index + 2;
      const parsed = skuImportRowSchema.safeParse(raw);
      if (parsed.success) rows.push({ row, data: parsed.data });
      else
        errors.push({
          row,
          sku: typeof raw.sku === 'string' ? raw.sku : undefined,
          // Our own rules answer a plain code the screen can translate; zod's
          // generic messages keep the column name so the row is easy to fix.
          error: parsed.error.issues
            .map((i) =>
              /^[a-z_]+$/.test(i.message)
                ? i.message
                : `${i.path.join('.') || 'row'}: ${i.message}`,
            )
            .join('; '),
        });
    });
    if (errors.length) return { created: 0, updated: 0, unchanged: 0, errors };
    return importSkus(this.prisma, { merchantId: body.merchantId, rows, actorUserId: user.sub });
  }
}
