import { HttpException } from '@nestjs/common';
import type { z } from 'zod';

/** Parses a request body or answers 400 with the problems. */
export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HttpException({ error: 'invalid', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400);
  }
  return r.data;
}
