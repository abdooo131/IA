import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function BackLink({ href }: { href: string }) {
  const t = await getTranslations('store.home');
  return (
    <Link href={href} className="text-body-sm font-bold text-link">
      <span aria-hidden className="inline-block rtl:rotate-180">
        ←
      </span>{' '}
      {t('back')}
    </Link>
  );
}
