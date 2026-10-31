'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';

const field = 'h-12 w-40 rounded-md border border-line bg-surface px-3 text-body';
const primary =
  'h-12 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const secondary =
  'h-12 rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50';

/** The merchant's own 60 minute price; turning it off stops the option at checkout. */
export function DeliveryPriceForm({ price }: { price: number | null }) {
  const t = useTranslations('merchant.delivery');
  const router = useRouter();
  const [current, setCurrent] = useState(price);
  const [text, setText] = useState(price == null ? '' : formatEgp(price).replace(/,/g, ''));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function save(value: number | null) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend('PUT', '/merchant/delivery', { expressPricePiastres: value });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: t('error'), error: true });
      return;
    }
    setCurrent(value);
    setMessage({ text: value == null ? t('turnedOff') : t('saved'), error: false });
    if (value == null) setText('');
    router.refresh();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseEgp(text);
    if (value == null || value > 10_000_000) {
      setMessage({ text: t('invalid'), error: true });
      return;
    }
    void save(value);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-body">
        {current == null ? t('off') : t('current', { price: formatEgp(current) })}
      </p>
      <label className="block text-caption">
        {t('price')}
        <span className="mt-1 flex items-center gap-2">
          <input
            name="price"
            inputMode="decimal"
            dir="ltr"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="45.00"
            className={field}
          />
          <span className="text-body-sm text-text-muted">{t('egp')}</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={busy}>
          {t('save')}
        </button>
        {current != null && (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => void save(null)}
          >
            {t('turnOff')}
          </button>
        )}
      </div>
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
