import { redirect } from 'next/navigation';

/** Tax returns are a tab of Taxes now; the old address opens it with the same choices. */
export default async function TaxReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; quarter?: string; taxYear?: string }>;
}) {
  const q = await searchParams;
  const query = new URLSearchParams({ tab: 'returns' });
  for (const [k, v] of Object.entries(q))
    if (typeof v === 'string' && /^[\d-]{1,7}$/.test(v)) query.set(k, v);
  redirect(`/finance/taxes?${query}`);
}
