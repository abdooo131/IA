import type { Tx } from './prisma.service';

const SEQUENCES = ['tracking_seq', 'pickup_seq', 'bag_seq', 'trip_seq', 'run_seq', 'payout_seq'] as const;
type Sequence = (typeof SEQUENCES)[number];

export async function nextNumber(tx: Tx, seq: Sequence): Promise<number> {
  if (!SEQUENCES.includes(seq)) throw new Error('unknown sequence');
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${seq}') AS n`);
  return Number(rows[0]!.n);
}

export async function nextCode(tx: Tx, seq: Exclude<Sequence, 'tracking_seq'>, prefix: string): Promise<string> {
  return `${prefix}${String(await nextNumber(tx, seq)).padStart(5, '0')}`;
}
