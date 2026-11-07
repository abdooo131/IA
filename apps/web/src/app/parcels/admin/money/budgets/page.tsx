'use client';
import { useEffect, useState } from 'react';
import { useRunner } from '@/parcels/components/money';
import { Button, Card, Input, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { egp, todayCairo } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

interface Row { code: string; name: string; nameAr: string; type: string; budget: number; actual: number; difference: number }

export default function BudgetsPage() {
  const t = useT();
  const locale = useLocale();
  const [month, setMonth] = useState(todayCairo().slice(0, 7));
  const b = useLoad<{ rows: Row[] }>(`/finance/budgets?month=${month}`);
  const r = useRunner(() => b.reload());
  const [edit, setEdit] = useState<Record<string, string>>({});
  useEffect(() => setEdit(Object.fromEntries((b.data?.rows ?? []).map((x) => [x.code, x.budget ? String(x.budget / 100) : '']))), [b.data]);
  if (!b.data) return <Loading />;
  const save = () =>
    r.run(() => api('/finance/budgets', { method: 'PUT', body: { month, lines: Object.entries(edit).filter(([, v]) => v !== '').map(([accountCode, v]) => ({ accountCode, amount: Math.round(Number(v) * 100) })) } }), 'Saved');
  return (
    <div className="space-y-5">
      <PageHeader title={t('Budgets')} subtitle={t('What we plan to earn and spend each month, against what happened')} actions={<div className="flex gap-2"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="ltr-iso w-40" /><Button onClick={() => void save()}>{t('Save')}</Button></div>} />
      {r.view}
      <Card>
        <Table head={[t('Account'), t('Budget (EGP)'), t('Actual'), t('Difference')]}>
          {b.data.rows.map((x) => {
            const bad = x.type === 'EXPENSE' ? x.difference > 0 : x.difference < 0;
            return (
              <tr key={x.code}>
                <Td><span className="ltr-iso text-text-muted">{x.code}</span> {locale === 'ar' ? x.nameAr : x.name}</Td>
                <Td><Input inputMode="decimal" className="ltr-iso w-32" value={edit[x.code] ?? ''} onChange={(e) => setEdit({ ...edit, [x.code]: e.target.value })} /></Td>
                <Td>{egp(x.actual)}</Td>
                <Td>{x.budget ? <span className={bad ? 'font-bold text-danger' : 'text-status-delivered'}>{egp(x.difference)}</span> : ''}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
