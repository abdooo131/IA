import { z } from 'zod';
import { passwordSchema } from './auth';
import { egyptianPhoneSchema } from './phone';

/**
 * Access rights (docs/ACCESS.md). Team members (admin, finance and store staff accounts)
 * get a level per app; riders and merchants keep their own areas.
 */

export const ACCESS_APPS = [
  'store',
  'operations',
  'inventory',
  'merchants',
  'customers',
  'accounting',
  'hr',
  'settings',
] as const;
export type AccessApp = (typeof ACCESS_APPS)[number];

export const ACCESS_LEVELS = ['none', 'view', 'use', 'manage'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** The levels each app offers: the store screens have no read only level, settings only manage. */
export const APP_LEVELS: Record<AccessApp, readonly AccessLevel[]> = {
  store: ['none', 'use', 'manage'],
  operations: ['none', 'view', 'use', 'manage'],
  inventory: ['none', 'view', 'use', 'manage'],
  merchants: ['none', 'view', 'use', 'manage'],
  customers: ['none', 'view', 'use', 'manage'],
  accounting: ['none', 'view', 'use', 'manage'],
  hr: ['none', 'view', 'use', 'manage'],
  settings: ['none', 'manage'],
};

/** The roles whose rights come from an access profile. */
export const TEAM_ROLES = ['admin', 'finance', 'store_staff'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export function isTeamRole(role: string): role is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(role);
}

export type AppLevels = Record<AccessApp, AccessLevel>;

export interface AccessTemplate extends AppLevels {
  allStores: boolean;
  customerData: boolean;
  salaries: boolean;
  /** Account managers: only the merchants whose account manager they are (docs/HR.md 5) */
  ownMerchantsOnly: boolean;
}

export const JOB_ROLES = [
  'owner',
  'operations_manager',
  'store_manager',
  'store_staff',
  'hub_staff',
  'dispatcher',
  'customer_service',
  'accountant',
  'finance_officer',
  'finance_manager',
  'hr_officer',
  'account_manager',
  'qc_agent',
] as const;
export type JobRole = (typeof JOB_ROLES)[number];
export type JobRoleLabel = JobRole | 'custom';

type Levels = [
  store: AccessLevel,
  operations: AccessLevel,
  inventory: AccessLevel,
  merchants: AccessLevel,
  customers: AccessLevel,
  accounting: AccessLevel,
  hr: AccessLevel,
  settings: AccessLevel,
];

function template(
  levels: Levels,
  allStores: boolean,
  customerData: boolean,
  salaries: boolean,
  ownMerchantsOnly = false,
): AccessTemplate {
  const [store, operations, inventory, merchants, customers, accounting, hr, settings] = levels;
  return {
    store,
    operations,
    inventory,
    merchants,
    customers,
    accounting,
    hr,
    settings,
    allStores,
    customerData,
    salaries,
    ownMerchantsOnly,
  };
}

/** The job roles table of docs/ACCESS.md, column for column. */
export const JOB_ROLE_TEMPLATES: Record<JobRole, AccessTemplate> = {
  owner: template(
    ['manage', 'manage', 'manage', 'manage', 'manage', 'manage', 'manage', 'manage'],
    true,
    true,
    true,
  ),
  operations_manager: template(
    ['manage', 'manage', 'manage', 'view', 'view', 'none', 'none', 'none'],
    true,
    false,
    false,
  ),
  store_manager: template(
    ['manage', 'use', 'use', 'none', 'none', 'none', 'none', 'none'],
    false,
    false,
    false,
  ),
  store_staff: template(
    ['use', 'none', 'none', 'none', 'none', 'none', 'none', 'none'],
    false,
    false,
    false,
  ),
  hub_staff: template(
    ['use', 'none', 'view', 'none', 'none', 'none', 'none', 'none'],
    false,
    false,
    false,
  ),
  dispatcher: template(
    ['use', 'use', 'view', 'none', 'none', 'none', 'none', 'none'],
    true,
    false,
    false,
  ),
  customer_service: template(
    ['none', 'use', 'view', 'view', 'view', 'none', 'none', 'none'],
    true,
    true,
    false,
  ),
  accountant: template(
    ['none', 'view', 'view', 'view', 'none', 'view', 'none', 'none'],
    true,
    false,
    false,
  ),
  finance_officer: template(
    ['none', 'view', 'view', 'view', 'none', 'use', 'none', 'none'],
    true,
    false,
    false,
  ),
  finance_manager: template(
    ['none', 'view', 'view', 'view', 'none', 'manage', 'none', 'none'],
    true,
    false,
    true,
  ),
  hr_officer: template(
    ['none', 'none', 'none', 'none', 'none', 'none', 'manage', 'none'],
    true,
    false,
    false,
  ),
  account_manager: template(
    ['none', 'view', 'view', 'use', 'view', 'none', 'none', 'none'],
    true,
    false,
    false,
    true,
  ),
  qc_agent: template(
    ['use', 'none', 'view', 'none', 'none', 'none', 'none', 'none'],
    false,
    false,
    false,
  ),
};

/** What one team member may open and do. Stores are the listed stores (ignored with allStores). */
export interface AccessProfile extends AccessTemplate {
  jobRole: JobRoleLabel;
  storeIds: string[];
  /** With ownMerchantsOnly: the merchants whose account manager this person is */
  merchantIds: string[];
}

/** A profile that opens nothing: what a team member without an access row gets. */
export const NO_ACCESS: AccessProfile = {
  jobRole: 'custom',
  store: 'none',
  operations: 'none',
  inventory: 'none',
  merchants: 'none',
  customers: 'none',
  accounting: 'none',
  hr: 'none',
  settings: 'none',
  allStores: false,
  customerData: false,
  salaries: false,
  ownMerchantsOnly: false,
  storeIds: [],
  merchantIds: [],
};

export function levelRank(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level);
}

/** True when the profile reaches at least `level` in `app` (none < view < use < manage). */
export function canDo(
  profile: Pick<AccessProfile, AccessApp> | null | undefined,
  app: AccessApp,
  level: AccessLevel,
): boolean {
  if (!profile) return level === 'none';
  return levelRank(profile[app]) >= levelRank(level);
}

/** True when the profile may work with this merchant (every merchant, or one they manage). */
export function canUseMerchant(
  profile: Pick<AccessProfile, 'ownMerchantsOnly' | 'merchantIds'> | null | undefined,
  merchantId: string,
): boolean {
  if (!profile) return false;
  return !profile.ownMerchantsOnly || profile.merchantIds.includes(merchantId);
}

/** True when the profile may work with this store (all stores, or one of its listed stores). */
export function canUseStore(
  profile: Pick<AccessProfile, 'allStores' | 'storeIds'> | null | undefined,
  darkStoreId: string,
): boolean {
  if (!profile) return false;
  return profile.allStores || profile.storeIds.includes(darkStoreId);
}

function sameValues(t: AccessTemplate, values: AccessTemplate) {
  return (
    ACCESS_APPS.every((app) => t[app] === values[app]) &&
    t.allStores === values.allStores &&
    t.customerData === values.customerData &&
    t.salaries === values.salaries &&
    t.ownMerchantsOnly === values.ownMerchantsOnly
  );
}

/**
 * The job role a set of values matches exactly, or custom. Two job roles can hold the same
 * values (QC agent and hub staff until the QC queue exists): `prefer`, the label chosen or
 * stored, wins when it matches.
 */
export function matchJobRole(values: AccessTemplate, prefer?: JobRoleLabel): JobRoleLabel {
  if (prefer && prefer !== 'custom' && sameValues(JOB_ROLE_TEMPLATES[prefer], values))
    return prefer;
  for (const role of JOB_ROLES) if (sameValues(JOB_ROLE_TEMPLATES[role], values)) return role;
  return 'custom';
}

const id = z.string().min(1).max(64);
const storeIdsSchema = z.array(id).max(200);

function levelFor(app: AccessApp) {
  return z.enum(APP_LEVELS[app] as [AccessLevel, ...AccessLevel[]]);
}

/**
 * Body of PUT /admin/users/:id/access: a job role (fills every field; storeIds for the roles
 * that work in listed stores) or custom values for every field.
 */
export const setAccessSchema = z.union([
  z.object({
    jobRole: z.enum(JOB_ROLES),
    storeIds: storeIdsSchema.optional(),
  }),
  z.object({
    jobRole: z.literal('custom'),
    store: levelFor('store'),
    operations: levelFor('operations'),
    inventory: levelFor('inventory'),
    merchants: levelFor('merchants'),
    customers: levelFor('customers'),
    accounting: levelFor('accounting'),
    hr: levelFor('hr').default('none'),
    settings: levelFor('settings'),
    allStores: z.boolean(),
    customerData: z.boolean(),
    salaries: z.boolean(),
    ownMerchantsOnly: z.boolean().default(false),
    storeIds: storeIdsSchema.optional(),
  }),
]);
export type SetAccessBody = z.infer<typeof setAccessSchema>;

/** The full values a job role or custom body stands for. */
export function accessFromBody(body: SetAccessBody): AccessTemplate & { jobRole: JobRoleLabel } {
  if (body.jobRole !== 'custom')
    return { ...JOB_ROLE_TEMPLATES[body.jobRole], jobRole: body.jobRole };
  const { storeIds: _ignored, jobRole: _custom, ...values } = body;
  return { ...values, jobRole: 'custom' };
}

// ─── merchant team ─────────────────────────────────────────────────────────────

export const MERCHANT_ROLES = ['owner', 'member'] as const;
export type MerchantTeamRole = (typeof MERCHANT_ROLES)[number];

/** orders; stock (shipments, products, returns, damage); money (wallet, payouts, statements,
 * invoices, bank details); settings (Shopify, 60 minute price, tax details, payout schedule). */
export const MERCHANT_RIGHTS = ['orders', 'stock', 'money', 'settings'] as const;
export type MerchantRightName = (typeof MERCHANT_RIGHTS)[number];

/** What a merchant user may do: owners have every right. */
export function merchantRightsOf(user: {
  merchantRole: MerchantTeamRole | null;
  merchantRights: readonly string[];
}): MerchantRightName[] {
  if (user.merchantRole !== 'member') return [...MERCHANT_RIGHTS];
  return MERCHANT_RIGHTS.filter((r) => user.merchantRights.includes(r));
}

const rightsSchema = z
  .array(z.enum(MERCHANT_RIGHTS))
  .max(MERCHANT_RIGHTS.length)
  .transform((list) => MERCHANT_RIGHTS.filter((r) => list.includes(r)));

export const createTeamMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  phone: egyptianPhoneSchema.nullable().optional(),
  password: passwordSchema,
  merchantRole: z.enum(MERCHANT_ROLES).default('member'),
  merchantRights: rightsSchema.default([]),
});
export type CreateTeamMemberBody = z.infer<typeof createTeamMemberSchema>;

export const updateTeamMemberSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  merchantRole: z.enum(MERCHANT_ROLES).optional(),
  merchantRights: rightsSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTeamMemberBody = z.infer<typeof updateTeamMemberSchema>;

/** What GET /me/access answers. */
export type MyAccess =
  | { kind: 'team'; role: TeamRole; profile: AccessProfile }
  | { kind: 'merchant'; merchantRole: MerchantTeamRole; rights: MerchantRightName[] }
  | { kind: 'rider' };
