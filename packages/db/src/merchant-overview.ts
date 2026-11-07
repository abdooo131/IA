import { cairoDay, cairoDayStart } from '@shiplynow/shared';
import { addMonths } from './finance/assets';
import type { Db } from './client';
import { DomainError } from './domain-error';
import { merchantOwed } from './finance/operations';
import { onboardingSteps } from './signup';

/**
 * The Overview, Products and Users tabs of one merchant's page (/admin/merchants/<id>): who
 * they are, how far they got with onboarding, this Cairo month's orders and fees (before
 * VAT, from the ledger), their products and units with us, and their team.
 */
export async function merchantOverview(db: Db, merchantId: string, now: Date = new Date()) {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    include: { accountManager: { select: { id: true, name: true } } },
  });
  if (!merchant) throw new DomainError('merchant_not_found', 404);
  const month = cairoDay(now).slice(0, 7);
  const from = cairoDayStart(`${month}-01`);
  const to = cairoDayStart(`${addMonths(month, 1)}-01`);
  const [placed, delivered, fees, skus, stock, shipments, returns, users] = await Promise.all([
    db.order.count({ where: { merchantId, createdAt: { gte: from, lt: to } } }),
    db.order.count({
      where: { merchantId, status: 'delivered', deliveredAt: { gte: from, lt: to } },
    }),
    db.$queryRaw<{ kind: string; fees: bigint | null }[]>`
      SELECT e.kind, -SUM(l.amount_piastres) AS fees FROM ledger_lines l
        JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.type = 'revenue' AND l.merchant_id = ${merchantId}
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY e.kind`,
    db.sku.groupBy({ by: ['isActive'], where: { merchantId }, _count: { _all: true } }),
    db.$queryRaw<
      {
        dark_store_id: string;
        code: string;
        name_en: string;
        name_ar: string;
        on_hand: bigint;
        reserved: bigint;
      }[]
    >`
      SELECT s.id AS dark_store_id, s.code, s.name_en, s.name_ar,
             SUM(l.on_hand) AS on_hand, SUM(l.reserved) AS reserved
      FROM stock_levels l
        JOIN skus k ON k.id = l.sku_id
        JOIN dark_stores s ON s.id = l.dark_store_id
      WHERE k.merchant_id = ${merchantId}
      GROUP BY s.id, s.code, s.name_en, s.name_ar
      ORDER BY s.code`,
    db.inboundManifest.count({
      where: { merchantId, status: { in: ['expected', 'receiving'] } },
    }),
    db.merchantReturn.count({
      where: { merchantId, status: { notIn: ['collected', 'cancelled'] } },
    }),
    db.user.findMany({
      where: { merchantId, role: 'merchant' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        merchantRole: true,
        merchantRights: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [{ merchantRole: 'asc' }, { name: 'asc' }],
    }),
  ]);
  const feesByKind = Object.fromEntries(fees.map((f) => [f.kind, Number(f.fees ?? 0)]));
  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      legalName: merchant.legalName,
      isActive: merchant.isActive,
      approval: merchant.approval,
      rejectReason: merchant.rejectReason,
      createdAt: merchant.createdAt,
      contactEmail: merchant.contactEmail,
      contactPhone: merchant.contactPhone,
      shopifyShopDomain: merchant.shopifyShopDomain,
      payoutSchedule: merchant.payoutSchedule,
      expressPricePiastres: merchant.expressPricePiastres,
      accountManager: merchant.accountManager,
    },
    onboarding: await onboardingSteps(db, merchantId),
    month: {
      month,
      ordersPlaced: placed,
      ordersDelivered: delivered,
      feesByKind,
      feesPiastres: Object.values(feesByKind).reduce((s, v) => s + v, 0),
    },
    owedPiastres: await merchantOwed(db, merchantId),
    products: {
      skus: skus.reduce((s, r) => s + r._count._all, 0),
      activeSkus: skus.find((r) => r.isActive)?._count._all ?? 0,
      openShipments: shipments,
      openReturns: returns,
      stores: stock.map((r) => ({
        darkStoreId: r.dark_store_id,
        code: r.code,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        onHand: Number(r.on_hand),
        reserved: Number(r.reserved),
      })),
    },
    users,
  };
}
export type MerchantOverview = Awaited<ReturnType<typeof merchantOverview>>;
