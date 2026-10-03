import type { Role } from '@shiply/shared';

export const MERCHANT: Role[] = ['MERCHANT_OWNER', 'MERCHANT_TEAM_MEMBER'];
export const ORDER_STAFF: Role[] = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCH', 'HUB_STAFF', 'QC_AGENT', 'FINANCE'];
export const ORDER_WRITERS: Role[] = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCH', 'HUB_STAFF'];
export const ADMINS: Role[] = ['SUPER_ADMIN', 'OPERATIONS_MANAGER'];
