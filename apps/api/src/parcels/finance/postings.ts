// How operations land in the books. Called inside the same transaction as the operation,
// so a parcel is never delivered without its money being recorded, and never twice.
import type { EarningKind, Shipment } from '@shiplynow/db';
import { ACCOUNTS, splitVat, type SettingValues } from '@shiplynow/shared/parcels';
import type { PrismaService, Tx } from '../common/prisma.service';
import { todayInCairo } from '../core/shipments.core';
import { post, rawBalance } from './ledger';

const DAY = 24 * 3600 * 1000;

/** Revenue lines for fees that include VAT: the amount before VAT to its revenue account, the VAT to VAT on sales. */
export function revenueLines(s: SettingValues, fees: { account: string; amount: number }[]) {
  let vat = 0;
  const lines = fees.map((f) => {
    const x = splitVat(f.amount, s['tax.vat_bp']);
    vat += x.vat;
    return { account: f.account, credit: x.net };
  });
  return [...lines, { account: ACCOUNTS.VAT_OUTPUT.code, credit: vat }];
}
const courier = (id: string) => ({ type: 'COURIER' as const, id });
const merchant = (id: string) => ({ type: 'MERCHANT' as const, id });

/** Staff whose pay goes to their agent at month end instead of their own withdrawals. */
export function paidByAgent(
  u: { agentId: string | null; courierType: string | null },
  s: SettingValues,
): boolean {
  if (!u.agentId) return false;
  return u.courierType !== 'PICKUP' || s['pay.pickup_paid_by'] === 'AGENT';
}

/** Records points (or a money amount) earned by a courier and books the cost. */
export async function earn(
  tx: Tx,
  s: SettingValues,
  a: {
    courierId: string;
    kind: EarningKind;
    points?: number;
    amount?: number;
    shipmentId?: string | null;
    note?: string;
    userId?: string | null;
    date?: string;
    /** The other side of the entry: where the money comes from (or goes to, for a deduction). Default: courier pay, or other income for penalties. */
    contra?: {
      account: string;
      party?: { type: 'COURIER' | 'HUB' | 'AGENT' | 'MERCHANT'; id: string };
    };
  },
) {
  const points = a.points ?? 0;
  const amount = a.amount ?? points * s['pay.point_value'];
  if (amount === 0 && points === 0) return null;
  const date = a.date ?? todayInCairo();
  if (a.shipmentId) {
    const done = await tx.courierEarning.findUnique({
      where: {
        courierId_kind_shipmentId: {
          courierId: a.courierId,
          kind: a.kind,
          shipmentId: a.shipmentId,
        },
      },
    });
    if (done) return done;
  }
  const u = await tx.user.findUniqueOrThrow({
    where: { id: a.courierId },
    select: { agentId: true },
  });
  const e = await tx.courierEarning.create({
    data: {
      courierId: a.courierId,
      agentId: u.agentId,
      kind: a.kind,
      points,
      amount,
      shipmentId: a.shipmentId ?? null,
      date,
      availableAt: new Date(
        Date.now() + (amount > 0 && !a.contra ? s['pay.freeze_days'] * DAY : 0),
      ),
      note: (a.note ?? '').slice(0, 200),
      createdById: a.userId ?? null,
    },
  });
  const positive = amount > 0;
  await post(tx, {
    memo: `${a.kind.toLowerCase()} ${a.note ?? ''}`.trim(),
    source: `EARNING_${a.kind}`,
    key: `EARNING:${e.id}`,
    date,
    userId: a.userId,
    lines: positive
      ? [
          a.contra
            ? { account: a.contra.account, party: a.contra.party ?? null, debit: amount }
            : { account: ACCOUNTS.COURIER_PAY.code, debit: amount },
          { account: ACCOUNTS.COURIER_WALLET.code, party: courier(a.courierId), credit: amount },
        ]
      : [
          { account: ACCOUNTS.COURIER_WALLET.code, party: courier(a.courierId), debit: -amount },
          a.contra
            ? { account: a.contra.account, party: a.contra.party ?? null, credit: -amount }
            : {
                account:
                  a.kind === 'PENALTY' ? ACCOUNTS.OTHER_INCOME.code : ACCOUNTS.COURIER_PAY.code,
                credit: -amount,
              },
        ],
  });
  return e;
}

/** Customer paid the courier: the cash is the courier's to hand in, the merchant is owed it less our fees. */
export async function postDelivered(
  tx: Tx,
  s: SettingValues,
  p: Shipment,
  courierId: string,
  userId: string,
) {
  await post(tx, {
    memo: `Delivered ${p.trackingNumber}`,
    source: 'DELIVERED',
    key: `DELIVERED:${p.id}`,
    userId,
    lines: [
      { account: ACCOUNTS.COURIER_CASH.code, party: courier(courierId), debit: p.codCollected },
      {
        account: ACCOUNTS.MERCHANT_WALLET.code,
        party: merchant(p.merchantId),
        credit: p.codCollected,
        memo: 'Cash collected',
      },
      {
        account: ACCOUNTS.MERCHANT_WALLET.code,
        party: merchant(p.merchantId),
        debit: p.shippingFee + p.codFee,
        memo: 'Fees',
      },
      ...revenueLines(s, [
        { account: ACCOUNTS.SHIPPING_REVENUE.code, amount: p.shippingFee },
        { account: ACCOUNTS.COD_FEE_REVENUE.code, amount: p.codFee },
      ]),
    ],
  });
  await earn(tx, s, {
    courierId,
    kind: 'DELIVERY',
    points: s['pay.points_delivery'],
    shipmentId: p.id,
    note: p.trackingNumber,
    userId,
  });
}

/** FlexShip: the customer refused but paid the shipping. The courier holds the cash; it goes to the merchant. */
export async function postFlexPaid(
  tx: Tx,
  p: Shipment,
  itemId: string,
  amount: number,
  courierId: string,
  userId: string,
) {
  await post(tx, {
    memo: `FlexShip ${p.trackingNumber}`,
    source: 'FLEX_PAID',
    key: `FLEX:${itemId}`,
    userId,
    lines: [
      { account: ACCOUNTS.COURIER_CASH.code, party: courier(courierId), debit: amount },
      {
        account: ACCOUNTS.MERCHANT_WALLET.code,
        party: merchant(p.merchantId),
        credit: amount,
        memo: 'Shipping paid by the customer who refused',
      },
    ],
  });
}

/** Handed back to the merchant: we charge shipping and the return fee. */
export async function postReturned(
  tx: Tx,
  s: SettingValues,
  p: Shipment,
  courierId: string,
  userId: string,
) {
  await post(tx, {
    memo: `Returned ${p.trackingNumber}`,
    source: 'RETURNED',
    key: `RETURNED:${p.id}`,
    userId,
    lines: [
      {
        account: ACCOUNTS.MERCHANT_WALLET.code,
        party: merchant(p.merchantId),
        debit: p.shippingFee + p.returnFee,
        memo: 'Shipping and return fee',
      },
      ...revenueLines(s, [
        { account: ACCOUNTS.SHIPPING_REVENUE.code, amount: p.shippingFee },
        { account: ACCOUNTS.RETURN_FEE_REVENUE.code, amount: p.returnFee },
      ]),
    ],
  });
  await earn(tx, s, {
    courierId,
    kind: 'RETURN',
    points: s['pay.points_return'],
    shipmentId: p.id,
    note: p.trackingNumber,
    userId,
  });
}

/** The facility received a parcel the pickup courier collected. */
export async function postPickupReceived(
  tx: Tx,
  s: SettingValues,
  p: Shipment,
  pickupCourierId: string,
  userId: string,
) {
  await earn(tx, s, {
    courierId: pickupCourierId,
    kind: 'PICKUP',
    points: s['pay.points_pickup_parcel'],
    shipmentId: p.id,
    note: p.trackingNumber,
    userId,
  });
}

/**
 * The hub counted the courier's cash. Cash moves from the courier to the hub safe; anything
 * short comes out of the courier's wallet, anything over is other income.
 * `due` is the run's cash less what the courier already paid in through Fawry for it.
 */
export async function postRunClosed(
  tx: Tx,
  s: SettingValues,
  run: { id: string; code: string; hubId: string; courierId: string; date: string },
  due: number,
  received: number,
  userId: string,
) {
  const moved = Math.min(due, received);
  const short = Math.max(0, due - received);
  const over = Math.max(0, received - due);
  await post(tx, {
    memo: `Cash from run ${run.code}`,
    source: 'RUN_CLOSED',
    key: `RUN_CLOSED:${run.id}`,
    userId,
    lines: [
      { account: ACCOUNTS.HUB_SAFE.code, party: { type: 'HUB', id: run.hubId }, debit: received },
      { account: ACCOUNTS.COURIER_CASH.code, party: courier(run.courierId), credit: moved },
      { account: ACCOUNTS.OTHER_INCOME.code, credit: over, memo: 'Cash over' },
    ],
  });
  // Cash short comes out of the courier's wallet: the courier no longer holds it, they owe it.
  if (short > 0) {
    await earn(tx, s, {
      courierId: run.courierId,
      kind: 'PENALTY',
      amount: -short,
      note: `Cash short on run ${run.code}`,
      userId,
      date: run.date,
      contra: { account: ACCOUNTS.COURIER_CASH.code, party: courier(run.courierId) },
    });
  }
  // Daily bonus once the courier reaches the target number of deliveries today.
  const target = s['pay.daily_bonus_parcels'];
  if (target > 0 && s['pay.daily_bonus_points'] > 0) {
    const today = run.date;
    const [done, already] = await Promise.all([
      tx.courierEarning.count({
        where: { courierId: run.courierId, kind: 'DELIVERY', date: today },
      }),
      tx.courierEarning.findFirst({
        where: { courierId: run.courierId, kind: 'BONUS', date: today, note: 'Daily bonus' },
      }),
    ]);
    if (done >= target && !already)
      await earn(tx, s, {
        courierId: run.courierId,
        kind: 'BONUS',
        points: s['pay.daily_bonus_points'],
        note: 'Daily bonus',
        userId,
        date: today,
      });
  }
  return { short, over };
}

/** What a courier has: wallet, what is still frozen, what can be withdrawn, cash still to hand in. */
export async function courierStanding(db: Tx | PrismaService, s: SettingValues, courierId: string) {
  const [walletRaw, cashRaw, frozen, u] = await Promise.all([
    rawBalance(db, ACCOUNTS.COURIER_WALLET.code, courier(courierId)),
    rawBalance(db, ACCOUNTS.COURIER_CASH.code, courier(courierId)),
    db.courierEarning.aggregate({
      where: { courierId, amount: { gt: 0 }, availableAt: { gt: new Date() }, settlementId: null },
      _sum: { amount: true },
    }),
    db.user.findUniqueOrThrow({
      where: { id: courierId },
      select: { agentId: true, courierType: true, unfreezeUntil: true, unfreezeReason: true },
    }),
  ]);
  const wallet = -walletRaw;
  const notYet = frozen._sum.amount ?? 0;
  const viaAgent = paidByAgent(u, s);
  const negative = wallet < 0;
  const overridden = !!u.unfreezeUntil && u.unfreezeUntil > new Date();
  return {
    wallet,
    cashToHandIn: cashRaw,
    notYetAvailable: Math.min(notYet, Math.max(0, wallet)),
    withdrawable: viaAgent ? 0 : Math.max(0, wallet - notYet),
    paidByAgent: viaAgent,
    frozen: negative && !overridden,
    unfreezeUntil: overridden ? u.unfreezeUntil : null,
    unfreezeReason: overridden ? u.unfreezeReason : '',
  };
}
