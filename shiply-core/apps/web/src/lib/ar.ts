// Arabic for the interface. English text is the key (see lib/i18n.tsx).
import { AR_ADMIN } from './ar-admin';
import { AR_COMMON } from './ar-common';
import { AR_MERCHANT } from './ar-merchant';
import { AR_MONEY } from './ar-money';
import { AR_OPS } from './ar-ops';
import { AR_WORKFORCE } from './ar-workforce';

export const AR: Record<string, string> = { ...AR_MONEY, ...AR_WORKFORCE, ...AR_COMMON, ...AR_OPS, ...AR_ADMIN, ...AR_MERCHANT };
