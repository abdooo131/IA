import { redirect } from 'next/navigation';

export default async function LocationIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/location/queue`);
}
