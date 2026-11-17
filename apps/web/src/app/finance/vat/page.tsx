import { redirect } from 'next/navigation';

/** The VAT report is a tab of Taxes now; the old address opens it. */
export default async function FinanceVatPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  redirect(`/finance/taxes?tab=vat${year && /^\d{4}$/.test(year) ? `&year=${year}` : ''}`);
}
