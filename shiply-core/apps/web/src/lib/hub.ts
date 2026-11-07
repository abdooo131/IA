/** What a worker should do with a parcel after a scan. */
export function nextText(next: { kind?: string; hubCode?: string; hubName?: string; merchantName?: string } | null | undefined, facility = true): string {
  switch (next?.kind) {
    case 'SEND': return facility ? `Hand to sorting: goes to ${next.hubCode} (${next.hubName})` : `Send back to ${next.hubCode} (${next.hubName})`;
    case 'DELIVER': return 'Keep here for delivery';
    case 'RETURN_TO_MERCHANT': return facility ? 'Hand to sorting: back to the merchant' : 'Keep here to return to the merchant';
    case 'HOLD': return 'Put on the hold shelf until the merchant decides';
    default: return '';
  }
}
