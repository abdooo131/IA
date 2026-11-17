'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { Person } from '@/lib/sales';

/** A manager gives a deal to a sales person, or back to the queue (sales manage). */
export function AssignOwner({
  dealId,
  ownerId,
  people,
  company,
}: {
  dealId: string;
  ownerId: string | null;
  people: Person[];
  company: string;
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [value, setValue] = useState(ownerId ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  async function save(next: string) {
    const previous = value;
    setValue(next);
    setState('busy');
    const result = await apiSend('POST', `/sales/deals/${dealId}/owner`, {
      ownerId: next || null,
    });
    if (!result.ok) {
      setValue(previous);
      return setState('error');
    }
    setState('idle');
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col">
      <select
        className="h-9 rounded-md border border-line-strong bg-surface px-2 text-body-sm"
        value={value}
        disabled={state === 'busy'}
        onChange={(e) => void save(e.target.value)}
        aria-label={t('assign.label', { company })}
      >
        <option value="">{t('unassigned')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {state === 'error' && (
        <span role="alert" className="text-caption text-danger">
          {t('errors.generic')}
        </span>
      )}
    </span>
  );
}
