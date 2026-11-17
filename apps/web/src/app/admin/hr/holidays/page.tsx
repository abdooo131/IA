import { redirect } from 'next/navigation';

/** HR phase 1: this page moved into one setup page; the old address opens the right tab. */
export default async function MovedPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  redirect(
    `/admin/hr/attendance-setup?tab=holidays${year && /^\d{4}$/.test(year) ? `&year=${year}` : ''}`,
  );
}
