import type { z } from 'zod';
import { DomainError } from './errors';

/** Parse a request body or query with zod, turning problems into one readable message. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
  throw new DomainError('invalid_input', message, 422);
}
