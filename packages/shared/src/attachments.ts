import { z } from 'zod';

/** At most this many files on one finance form. */
export const MAX_FORM_ATTACHMENTS = 10;

/**
 * The receipts and documents a finance form uploaded before saving (POST /finance/files); the
 * save links them to the record it makes in the same transaction.
 */
export const attachmentIdsField = z
  .array(z.string().min(1).max(64))
  .max(MAX_FORM_ATTACHMENTS)
  .optional();
