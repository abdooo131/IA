import { z } from 'zod';
import { isCalendarDay } from './hours';

// Reading bank statement files. Banks export dates and amounts in many shapes (CIB uses
// 01/11/2026 or 01-Nov-2026, Excel stores dates as day numbers, amounts carry commas,
// "EGP", brackets or a CR/DR mark). These turn one cell into a clean value, or null.

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const ARABIC_DIGITS = /[٠-٩]/g;
const latin = (s: string) =>
  s
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');

function day(y: number, m: number, d: number) {
  if (y < 100) y += 2000;
  const text = `${y}-${pad(m)}-${pad(d)}`;
  return isCalendarDay(text) ? text : null;
}

/** A statement date as YYYY-MM-DD: day first (Egyptian banks), ISO, a month name, or an Excel day number. */
export function parseStatementDate(cell: string): string | null {
  const s = latin(cell).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return day(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return day(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})[\s\-/]([A-Za-z]{3})[A-Za-z]*[\s\-/,]+(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2]!.toLowerCase()]) return day(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!);
  // Excel keeps dates as days since 30 December 1899.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 30000 || serial > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * An amount in piastres from a statement cell: "1,234.50", "(500.00)", "-20", "300.00 CR",
 * "EGP 12". Brackets, a minus or DR make it negative. Empty cells are null. No floats: the
 * pounds and piastres are read as text.
 */
export function parseStatementAmount(cell: string): number | null {
  let s = latin(cell).trim().toUpperCase();
  if (!s || s === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\.?$/.test(s)) negative = true;
  s = s.replace(/\b(EGP|LE|L\.E\.?|CR|DR)\.?/g, '').replace(/[\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const m = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (!m) return null;
  const piastres = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
  if (!Number.isSafeInteger(piastres)) return null;
  return negative ? -piastres : piastres;
}

export const statementLineSchema = z.object({
  day: z.string().refine(isCalendarDay, 'invalid_day'),
  description: z.string().trim().min(1).max(300),
  reference: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  amountPiastres: z
    .number()
    .int()
    .min(-1_000_000_000_00)
    .max(1_000_000_000_00)
    .refine((v) => v !== 0, 'zero_amount'),
  balancePiastres: z.number().int().optional(),
});

export const statementImportSchema = z.object({
  accountId: z.string().min(1).max(64),
  fileName: z.string().trim().min(1).max(200),
  lines: z.array(statementLineSchema).min(1).max(5000),
});
export type StatementLineInput = z.infer<typeof statementLineSchema>;

export const statementNumber = (n: number) => `BS-${pad(n).padStart(6, '0')}`;
