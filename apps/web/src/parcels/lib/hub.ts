import type { ScanOutcome } from '@/parcels/components/ScanBox';

type T = (text: string, vars?: Record<string, string | number>) => string;
type Next = { kind?: string; hubCode?: string; hubName?: string; merchantName?: string } | null | undefined;

/** What a worker should do with a parcel after a scan, as a big code and a line of text. */
export function nextOutcome(next: Next, facility: boolean, t: T, message: string, warning?: string): ScanOutcome {
  const warn = warning ? t(warning) : undefined;
  switch (next?.kind) {
    case 'SEND':
      return { big: next.hubCode, text: `${t(message)}. ${facility ? t('Hand to sorting: goes to {hub}', { hub: next.hubName ?? '' }) : t('Send back to {hub}', { hub: next.hubName ?? '' })}`, warn };
    case 'DELIVER':
      return { big: t('DELIVER'), text: `${t(message)}. ${t('Keep here for delivery')}`, warn };
    case 'RETURN_TO_MERCHANT':
      return { big: t('RETURN'), tone: 'return', text: `${t(message)}. ${facility ? t('Hand to sorting: back to the merchant') : t('Keep here to return to the merchant')}`, warn };
    case 'HOLD':
      return { big: t('HOLD'), tone: 'hold', text: `${t(message)}. ${t('Put on the hold shelf until the merchant decides')}`, warn };
    default:
      return { text: t(message), warn };
  }
}
