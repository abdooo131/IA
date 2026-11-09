import { redirect } from 'next/navigation';

export default async function MerchantsIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/merchants/list`);
}
