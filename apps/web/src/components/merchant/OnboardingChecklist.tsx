import { useTranslations } from 'next-intl';
import Link from 'next/link';

export interface OnboardingSteps {
  products: boolean;
  price: boolean;
  shopify: boolean;
  shipment: boolean;
}

const STEPS: { key: keyof OnboardingSteps; href: string }[] = [
  { key: 'products', href: '/merchant/products' },
  { key: 'price', href: '/merchant/delivery' },
  { key: 'shopify', href: '/merchant/shopify' },
  { key: 'shipment', href: '/merchant/new' },
];

/** First steps for a new merchant; hidden once every step is done. */
export function OnboardingChecklist({ steps }: { steps: OnboardingSteps }) {
  const t = useTranslations('merchant.onboarding');
  const left = STEPS.filter((s) => !steps[s.key]).length;
  if (left === 0) return null;
  return (
    <section className="mt-4 rounded-lg border border-primary bg-surface p-5">
      <h2 className="text-h3">{t('title')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('left', { count: left })}</p>
      <ol className="mt-3 space-y-2">
        {STEPS.map((s) => (
          <li key={s.key} className="flex items-center gap-3 text-body-sm">
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-bold ${
                steps[s.key] ? 'bg-status-delivered text-white' : 'border border-line'
              }`}
            >
              {steps[s.key] ? '✓' : ''}
            </span>
            {steps[s.key] ? (
              <span className="text-text-muted line-through">{t(`steps.${s.key}`)}</span>
            ) : (
              <Link href={s.href} className="text-link underline">
                {t(`steps.${s.key}`)}
              </Link>
            )}
            <span className="sr-only">{steps[s.key] ? t('done') : t('todo')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
