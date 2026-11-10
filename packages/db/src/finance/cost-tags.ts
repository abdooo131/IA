import {
  addDays,
  cairoDayStart,
  comparisonRange,
  type CompareMode,
  isCalendarDay,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { ownerNames } from './books';

// Cost tags: the user's own analytic tags (a Ramadan campaign, a new branch project) beside the
// store, merchant and rider tags every line already carries. Accounting manage opens them;
// expenses, journal entry lines, supplier bills and petty cash may carry one per line
// (ledger_lines.cost_tag_id, set through post()'s LineTags). Lines posted before keep none.

export async function listCostTags(db: Db, options: { activeOnly?: boolean } = {}) {
  const tags = await db.costTag.findMany({
    where: options.activeOnly ? { isActive: true } : undefined,
    orderBy: { nameEn: 'asc' },
  });
  const used = await db.ledgerLine.groupBy({
    by: ['costTagId'],
    where: { costTagId: { in: tags.map((t) => t.id) } },
    _count: { _all: true },
  });
  return tags.map((t) => ({
    id: t.id,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    isActive: t.isActive,
    lines: used.find((u) => u.costTagId === t.id)?._count._all ?? 0,
  }));
}

export function createCostTag(
  db: Db,
  input: { nameEn: string; nameAr: string; actorUserId: string },
) {
  const nameEn = input.nameEn.trim();
  const nameAr = input.nameAr.trim();
  if (nameEn.length < 2 || nameAr.length < 2) throw new DomainError('name_required', 400);
  return inTransaction(db, async (tx) => {
    const same = await tx.costTag.findFirst({
      where: { nameEn: { equals: nameEn, mode: 'insensitive' } },
    });
    if (same) throw new DomainError('cost_tag_exists');
    const tag = await tx.costTag.create({
      data: { nameEn, nameAr, createdById: input.actorUserId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cost_tag_create',
      entityType: 'cost_tag',
      entityId: tag.id,
      after: { nameEn, nameAr },
    });
    return tag;
  });
}

/** Renames a tag or switches it off (lines keep it; new ones cannot take it). */
export function updateCostTag(
  db: Db,
  input: {
    costTagId: string;
    nameEn?: string;
    nameAr?: string;
    isActive?: boolean;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.costTag.findUnique({ where: { id: input.costTagId } });
    if (!before) throw new DomainError('cost_tag_not_found', 404);
    const nameEn = input.nameEn?.trim();
    if (nameEn && nameEn.toLowerCase() !== before.nameEn.toLowerCase()) {
      const same = await tx.costTag.findFirst({
        where: { nameEn: { equals: nameEn, mode: 'insensitive' } },
      });
      if (same) throw new DomainError('cost_tag_exists');
    }
    const after = await tx.costTag.update({
      where: { id: before.id },
      data: {
        nameEn: nameEn || undefined,
        nameAr: input.nameAr?.trim() || undefined,
        isActive: input.isActive,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.cost_tag_update',
      entityType: 'cost_tag',
      entityId: before.id,
      before: { nameEn: before.nameEn, nameAr: before.nameAr, isActive: before.isActive },
      after: { nameEn: after.nameEn, nameAr: after.nameAr, isActive: after.isActive },
    });
    return after;
  });
}

export interface TagAccountLine {
  accountId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: 'revenue' | 'expense';
  /** Income shown positive, costs shown positive (the natural side) */
  amountPiastres: number;
  compareAmountPiastres: number | null;
}

export interface TagReportRow {
  /** null: lines with no cost tag (only when asked) */
  id: string | null;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  incomePiastres: number;
  costsPiastres: number;
  /** income − costs */
  netPiastres: number;
  compareIncomePiastres: number | null;
  compareCostsPiastres: number | null;
  compareNetPiastres: number | null;
  accounts: TagAccountLine[];
}

/** Income and cost sums per tag and account of a period (year end entries left out). */
async function sums(db: Db, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ tag: string; account_id: string; amount: bigint }[]>`
    SELECT l.cost_tag_id AS tag, l.account_id, SUM(l.amount_piastres)::bigint AS amount
    FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      JOIN ledger_entries e ON e.id = l.entry_id
    WHERE l.cost_tag_id IS NOT NULL
      AND a.category IN ('revenue', 'expense')
      AND e.kind <> 'year_close'
      AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
    GROUP BY l.cost_tag_id, l.account_id`;
  return rows.map((r) => ({ tag: r.tag, accountId: r.account_id, raw: Number(r.amount) }));
}

/**
 * Costs and income by tag: per tag, the income and cost accounts its lines touched in the
 * period (with the comparison period beside them) and the tag's net. Each figure drills down
 * to its ledger lines (/finance/reports/lines?set=income_costs&tag=<id>, or account=<id>).
 */
export async function costTagReport(
  db: Db,
  input: { from: string; to: string; compare?: CompareMode },
) {
  if (!isCalendarDay(input.from) || !isCalendarDay(input.to))
    throw new DomainError('invalid_date', 400);
  if (input.to < input.from) throw new DomainError('invalid_range', 400);
  const mode = input.compare ?? 'none';
  const other = comparisonRange({ from: input.from, to: input.to }, mode);
  const range = (f: string, t: string) => [cairoDayStart(f), cairoDayStart(addDays(t, 1))] as const;
  const [cur, prev, tags, accounts, name] = await Promise.all([
    sums(db, ...range(input.from, input.to)),
    other ? sums(db, ...range(other.from, other.to)) : null,
    db.costTag.findMany({ orderBy: { nameEn: 'asc' } }),
    db.ledgerAccount.findMany({ where: { category: { in: ['revenue', 'expense'] } } }),
    ownerNames(db),
  ]);
  const natural = (category: string, raw: number) => (category === 'expense' ? raw : 0 - raw);
  const rows: TagReportRow[] = [];
  for (const tag of tags) {
    const mine = cur.filter((r) => r.tag === tag.id);
    const theirs = prev?.filter((r) => r.tag === tag.id) ?? null;
    if (mine.length === 0 && !theirs?.length) continue;
    const ids = new Set([...mine, ...(theirs ?? [])].map((r) => r.accountId));
    const lines: TagAccountLine[] = [];
    for (const id of ids) {
      const a = accounts.find((x) => x.id === id);
      if (!a) continue;
      const category = a.category as 'revenue' | 'expense';
      const sum = (rs: typeof mine) =>
        natural(
          category,
          rs.filter((r) => r.accountId === id).reduce((s, r) => s + r.raw, 0),
        );
      lines.push({
        accountId: id,
        code: a.code,
        ...name(a),
        category,
        amountPiastres: sum(mine),
        compareAmountPiastres: theirs ? sum(theirs) : null,
      });
    }
    lines.sort((x, y) => x.code.localeCompare(y.code));
    const total = (category: string, pick: (l: TagAccountLine) => number | null) =>
      lines.filter((l) => l.category === category).reduce((s, l) => s + (pick(l) ?? 0), 0);
    const income = total('revenue', (l) => l.amountPiastres);
    const costs = total('expense', (l) => l.amountPiastres);
    const cIncome = theirs ? total('revenue', (l) => l.compareAmountPiastres) : null;
    const cCosts = theirs ? total('expense', (l) => l.compareAmountPiastres) : null;
    rows.push({
      id: tag.id,
      nameEn: tag.nameEn,
      nameAr: tag.nameAr,
      isActive: tag.isActive,
      incomePiastres: income,
      costsPiastres: costs,
      netPiastres: income - costs,
      compareIncomePiastres: cIncome,
      compareCostsPiastres: cCosts,
      compareNetPiastres: cIncome === null || cCosts === null ? null : cIncome - cCosts,
      accounts: lines,
    });
  }
  const add = (pick: (r: TagReportRow) => number | null) =>
    rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  return {
    from: input.from,
    to: input.to,
    compare: other ? { mode, ...other } : null,
    rows,
    totals: {
      incomePiastres: add((r) => r.incomePiastres),
      costsPiastres: add((r) => r.costsPiastres),
      netPiastres: add((r) => r.netPiastres),
      compareIncomePiastres: other ? add((r) => r.compareIncomePiastres) : null,
      compareCostsPiastres: other ? add((r) => r.compareCostsPiastres) : null,
      compareNetPiastres: other ? add((r) => r.compareNetPiastres) : null,
    },
  };
}
