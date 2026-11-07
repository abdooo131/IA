// The parcel network posts to Shiply Now's ledger. Its postings keep the shape they always had
// (an account code, a party, a debit or a credit) and this adapter turns each line into one of
// Shiply Now's accounts. Every line is tagged with the Shiply company and, when known, the
// facility or hub, which is its cost center.
import { type AccountRef, balanceOf, post as postEntry } from '@shiplynow/db';
import type { PartyType } from '@shiplynow/shared/parcels';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../common/errors';
import type { PrismaService, Tx } from '../common/prisma.service';
import { todayInCairo } from '../core/shipments.core';

export interface Line {
  /** Account code, for example ACCOUNTS.BANK.code. */
  account: string;
  party?: { type: PartyType; id: string } | null;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface EntryInput {
  memo: string;
  source: string;
  /** Posting the same key twice does nothing: events can be retried safely. */
  key?: string;
  date?: string;
  userId?: string | null;
  /** The facility or hub the entry counts for (its cost center). */
  hubId?: string | null;
  lines: Line[];
}

type System = Extract<AccountRef, { type: string }>['type'];
const SYSTEM: Record<string, System> = {
  '1000': 'bank',
  '1300': 'packaging_stock',
  '1500': 'vat_payable',
  '2400': 'vat_payable',
  '2410': 'wht_payable',
  '3000': 'retained_earnings',
  '4000': 'parcel_shipping_revenue',
  '4010': 'parcel_cod_fee_revenue',
  '4020': 'parcel_return_fee_revenue',
  '4030': 'parcel_cashout_fee_revenue',
  '4040': 'parcel_packaging_sales',
  '4900': 'parcel_other_income',
  '5000': 'parcel_courier_pay',
  '5010': 'parcel_agent_commission',
  '5020': 'parcel_vehicle_rent',
  '5030': 'parcel_special_vehicles',
  '5255': 'parcel_packaging_cost',
  '5300': 'parcel_lost_parcels',
};

/** Shiply Now's account for one of the network's account codes and parties. */
export function accountRef(code: string, party?: { type: PartyType; id: string } | null): AccountRef {
  const need = (type: PartyType) => {
    if (party?.type !== type) throw new Error(`account ${code} needs a ${type} party`);
    return party.id;
  };
  switch (code) {
    case '1100':
      return { type: 'hub_safe', hubId: need('HUB') };
    case '1200':
      return { type: 'courier_cash', userId: need('COURIER') };
    case '2100':
      return { type: 'merchant', merchantId: need('MERCHANT') };
    case '2200':
      return { type: 'courier_wallet', userId: need('COURIER') };
    case '2300':
      return { type: 'agent_payable', agentId: need('AGENT') };
    case '2500':
      return { type: 'supplier', supplierId: need('SUPPLIER') };
  }
  const system = SYSTEM[code];
  if (!system) throw new DomainError('invalid_input', `Unknown account ${code}`, 422);
  return { type: system } as AccountRef;
}

/** A Cairo day as the moment it is booked: now for today, noon Cairo time for another day. */
function moment(date?: string) {
  if (!date || date === todayInCairo()) return new Date();
  return new Date(`${date}T12:00:00+02:00`);
}

/**
 * The only way the network's money enters the books. Lines are one sided and must balance; the
 * same key posts once. Returns null when every line is zero.
 */
export async function post(tx: Tx, e: EntryInput) {
  const lines = e.lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  if (lines.length === 0) return null;
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0 || (d > 0 && c > 0)) throw new Error(`bad journal line on ${l.account}`);
    debit += d;
    credit += c;
  }
  if (debit !== credit) throw new DomainError('unbalanced', `Debits ${debit} and credits ${credit} do not match`, 422);
  const merchantId = lines.find((l) => l.party?.type === 'MERCHANT')?.party?.id ?? null;
  // The cost center: the hub named, else the courier's hub, else the merchant's facility.
  let hubId = e.hubId ?? lines.find((l) => l.party?.type === 'HUB')?.party?.id ?? null;
  const courierId = lines.find((l) => l.party?.type === 'COURIER')?.party?.id;
  if (!hubId && courierId) hubId = (await tx.user.findUnique({ where: { id: courierId }, select: { hubId: true } }))?.hubId ?? null;
  if (!hubId && merchantId) hubId = (await tx.merchant.findUnique({ where: { id: merchantId }, select: { homeHubId: true } }))?.homeHubId ?? null;
  return postEntry(tx, {
    kind: `parcels.${e.source.toLowerCase()}`,
    idempotencyKey: `parcels:${e.key ?? randomUUID()}`,
    occurredAt: moment(e.date),
    memo: e.memo.slice(0, 300),
    createdById: e.userId ?? null,
    company: 'shiply',
    hubId,
    merchantId,
    lines: lines.map((l) => ({
      account: accountRef(l.account, l.party),
      amount: (l.debit ?? 0) - (l.credit ?? 0),
      tags: l.party?.type === 'COURIER' ? { userId: l.party.id } : undefined,
    })),
  });
}

/** Debits minus credits on an account, for one party or all of them. */
export async function rawBalance(db: Tx | PrismaService, account: string, party?: { type: PartyType; id: string }, through?: string) {
  if (!party && ['1100', '1200', '2100', '2200', '2300', '2500'].includes(account)) {
    const all = await partyBalances(db, account);
    return [...all.values()].reduce((s, v) => s + v, 0);
  }
  const before = through ? new Date(new Date(`${through}T00:00:00+02:00`).getTime() + 24 * 3600e3) : undefined;
  return balanceOf(db, accountRef(account, party), before);
}

const TYPE_OF: Record<string, { type: 'hub_safe' | 'courier_cash' | 'merchant' | 'courier_wallet' | 'agent_payable' | 'supplier'; owner: 'hubId' | 'userId' | 'merchantId' | 'agentId' | 'supplierId' }> = {
  '1100': { type: 'hub_safe', owner: 'hubId' },
  '1200': { type: 'courier_cash', owner: 'userId' },
  '2100': { type: 'merchant', owner: 'merchantId' },
  '2200': { type: 'courier_wallet', owner: 'userId' },
  '2300': { type: 'agent_payable', owner: 'agentId' },
  '2500': { type: 'supplier', owner: 'supplierId' },
};

/** Balance of every party on one wallet account, as a map of party id to debits minus credits. */
export async function partyBalances(db: Tx | PrismaService, account: string): Promise<Map<string, number>> {
  const t = TYPE_OF[account];
  if (!t) throw new Error(`account ${account} has no parties`);
  const accounts = await db.ledgerAccount.findMany({ where: { type: t.type }, select: { id: true, hubId: true, userId: true, merchantId: true, agentId: true, supplierId: true } });
  if (!accounts.length) return new Map();
  const sums = await db.ledgerLine.groupBy({ by: ['accountId'], where: { accountId: { in: accounts.map((a) => a.id) } }, _sum: { amountPiastres: true } });
  const owner = new Map(accounts.map((a) => [a.id, a[t.owner]]));
  const out = new Map<string, number>();
  for (const s of sums) {
    const id = owner.get(s.accountId);
    if (id) out.set(id, (out.get(id) ?? 0) + (s._sum.amountPiastres ?? 0));
  }
  return out;
}
