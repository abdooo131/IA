/**
 * Old list addresses (before the list views) named their filters as plain params
 * (?store=..., ?merchant=..., ?status=...). This turns them into the list state (v= values,
 * f= filters) so old links still open the right rows; null when there is nothing to turn.
 */
export function legacyListAddress(
  path: string,
  params: Record<string, string | string[] | undefined>,
  map: Record<string, { value: string } | { filter: true }>,
): string | null {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  if (one('f') !== undefined || one('v') !== undefined) return null;
  const values: string[] = [];
  const filters: string[] = [];
  for (const [param, to] of Object.entries(map)) {
    const v = one(param);
    if (!v || !/^[A-Za-z0-9_-]{1,40}$/.test(v)) continue;
    if ('value' in to) values.push(`${to.value}:${v}`);
    else filters.push(v);
  }
  if (!values.length && !filters.length) return null;
  const query = new URLSearchParams({ f: filters.join(',') });
  if (values.length) query.set('v', values.join(','));
  const q = one('q');
  if (q) query.set('q', q);
  return `${path}?${query}`;
}
