import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: booleanString,
  /** Optional. Without it, address lookups answer geocoding_not_configured. */
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  /** Set to osm to use OpenStreetMap when there is no Google key (local testing only). */
  GEOCODER: z.enum(['google', 'osm']).default('google'),
  /** Background jobs (SLA check). Off in tests, on everywhere else unless set to false. */
  JOBS_ENABLED: z.enum(['true', 'false']).optional(),
  /** Shopify app client ID (not secret). Without it the Shopify connection stays off. */
  SHOPIFY_API_KEY: z.string().optional(),
  /** Shopify app client secret: signs Shopify's requests and protects stored tokens */
  SHOPIFY_API_SECRET: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default('2026-10'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
