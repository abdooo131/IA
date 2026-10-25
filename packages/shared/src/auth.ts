import { z } from 'zod';
import { ROLES } from './roles';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z.string().min(10).max(200);

export const roleSchema = z.enum(ROLES);

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  phone: z.string().nullable(),
  role: roleSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/** Claims carried in the access token. Shared by the API and the web middleware. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: z.infer<typeof roleSchema>;
}

export const ACCESS_TOKEN_COOKIE = 'shiply_at';
export const REFRESH_TOKEN_COOKIE = 'shiply_rt';
