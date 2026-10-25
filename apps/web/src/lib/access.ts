import type { Role } from '@shiplynow/shared';

/** Which roles may open each area. Admins can open every area. */
export const AREA_ROLES = {
  '/admin': ['admin'],
  '/store': ['admin', 'store_staff'],
  '/rider': ['admin', 'rider'],
} as const satisfies Record<string, readonly Role[]>;

export type Area = keyof typeof AREA_ROLES;

const HOME_BY_ROLE: Record<Role, Area | null> = {
  admin: '/admin',
  store_staff: '/store',
  rider: '/rider',
  // Merchants have no web area in the pilot; they work through the Shopify app.
  merchant: null,
};

export function homeFor(role: Role): Area | null {
  return HOME_BY_ROLE[role];
}

export function areaOf(pathname: string): Area | null {
  for (const area of Object.keys(AREA_ROLES) as Area[]) {
    if (pathname === area || pathname.startsWith(`${area}/`)) return area;
  }
  return null;
}

/** Only same origin paths are accepted as a redirect target, to avoid open redirects. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}

export type AccessDecision =
  | { kind: 'allow' }
  | { kind: 'login'; next: string }
  | { kind: 'refresh'; next: string }
  | { kind: 'redirect'; to: string };

/**
 * Decides what the middleware does for a request to a protected area.
 * `role` is null when there is no valid access token.
 */
export function decideAccess(input: {
  pathname: string;
  search: string;
  role: Role | null;
  hasRefreshToken: boolean;
}): AccessDecision {
  const area = areaOf(input.pathname);
  if (!area) return { kind: 'allow' };

  const next = input.pathname + input.search;
  if (!input.role) {
    return input.hasRefreshToken ? { kind: 'refresh', next } : { kind: 'login', next };
  }
  if ((AREA_ROLES[area] as readonly Role[]).includes(input.role)) return { kind: 'allow' };
  return { kind: 'redirect', to: homeFor(input.role) ?? '/' };
}
