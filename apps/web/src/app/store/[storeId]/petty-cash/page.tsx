import { redirect } from 'next/navigation';

/** Petty cash is not paid from the store screens (owner, 2026-11-08); expenses go through Accounting. */
export default async function StorePettyCashPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  redirect(`/store/${storeId}`);
}
