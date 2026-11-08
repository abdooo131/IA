import type { SkuImportResult } from '@shiplynow/db';
import { type SkuImportRow, skuImportRowSchema } from '@shiplynow/shared';

/**
 * Checks the rows of a product file (the browser already split the CSV into objects keyed by
 * header). Answers the valid rows, or every error so nothing is written (all or nothing).
 */
export function parseSkuImportRows(raws: Record<string, unknown>[]): {
  rows: { row: number; data: SkuImportRow }[];
  errors: SkuImportResult['errors'];
} {
  const rows: { row: number; data: SkuImportRow }[] = [];
  const errors: SkuImportResult['errors'] = [];
  raws.forEach((raw, index) => {
    // Row 1 of the file is the header, so data starts on row 2.
    const row = index + 2;
    const parsed = skuImportRowSchema.safeParse(raw);
    if (parsed.success) rows.push({ row, data: parsed.data });
    else
      errors.push({
        row,
        sku: typeof raw.sku === 'string' ? raw.sku : undefined,
        // Our own rules answer a plain code the screen can translate; zod's generic
        // messages keep the column name so the row is easy to fix.
        error: parsed.error.issues
          .map((i) =>
            /^[a-z_]+$/.test(i.message) ? i.message : `${i.path.join('.') || 'row'}: ${i.message}`,
          )
          .join('; '),
      });
  });
  return { rows, errors };
}
