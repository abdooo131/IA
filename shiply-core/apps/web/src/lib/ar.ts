// Arabic for the interface. English text is the key (see lib/i18n.tsx).
import { AR_ADMIN } from './ar-admin';
import { AR_COMMON } from './ar-common';
import { AR_MERCHANT } from './ar-merchant';
import { AR_BOOKS } from './ar-books';
import { AR_CONTROL } from './ar-control';
import { AR_DRIVER } from './ar-driver';
import { AR_SHOP } from './ar-shop';
import { AR_API } from './ar-api';
import { AR_SHOPIFY } from './ar-shopify';
import { AR_MERCHANTS } from './ar-merchants';
import { AR_MONEY } from './ar-money';
import { AR_OPS } from './ar-ops';
import { AR_WORKFORCE } from './ar-workforce';

export const AR: Record<string, string> = { ...AR_SHOPIFY, ...AR_API, ...AR_SHOP, ...AR_DRIVER, ...AR_MERCHANTS, ...AR_CONTROL, ...AR_BOOKS, ...AR_MONEY, ...AR_WORKFORCE, ...AR_COMMON, ...AR_OPS, ...AR_ADMIN, ...AR_MERCHANT };
