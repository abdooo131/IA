/** What a hub worker should do with a parcel after a scan. */
export function nextText(next: { kind?: string; hubCode?: string; hubName?: string } | null | undefined): string {
  switch (next?.kind) {
    case 'SEND': return `Sort to ${next.hubCode} (${next.hubName})`;
    case 'DELIVER': return 'Keep here for delivery';
    case 'RETURN_TO_MERCHANT': return 'Keep here to return to the merchant';
    case 'HOLD': return 'Put on the hold shelf until the merchant decides';
    default: return '';
  }
}
