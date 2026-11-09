import { redirect } from 'next/navigation';

export default async function AccountingIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/accounting/wallets`);
}
