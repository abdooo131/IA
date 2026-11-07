'use client';
import { useState } from 'react';
import { useRunner } from '@/components/money';
import { Badge, Button, Card, Empty, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface Rec {
  bookBalance: number;
  statementTotal: number;
  lines: { id: string; date: string; description: string; reference: string; amount: number; matched: { number: number; date: string; memo: string } | null }[];
  unmatchedBook: { id: string; date: string; memo: string; number: number; amount: number }[];
}

/** The bank's statement next to our books: matched lines, and what is on one side only. */
export default function BankPage() {
  const t = useT();
  const locale = useLocale();
  const rec = useLoad<Rec>('/finance/bank');
  const accounts = useLoad<{ code: string; name: string; nameAr: string; party: string | null; active: boolean }[]>('/finance/accounts');
  const r = useRunner(() => rec.reload());
  const [bookAs, setBookAs] = useState<Record<string, string>>({});
  if (!rec.data || !accounts.data) return <Loading />;
  const plain = accounts.data.filter((a) => !a.party && a.active && a.code !== '1000');
  const upload = (file: File | undefined) =>
    file &&
    r.run(async () => {
      const csv = await file.text();
      const x = await api<{ rows: number; matched: number; skippedLines: number[] }>('/finance/bank/import', { body: { fileName: file.name, csv } });
      r.setMsg({ ok: true, text: t('{rows} lines read, {matched} matched', { rows: x.rows, matched: x.matched }) + (x.skippedLines.length ? ` · ${t('Skipped lines')}: ${x.skippedLines.join(', ')}` : '') });
    }, 'Done');
  const open = rec.data.lines.filter((l) => !l.matched);
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Bank matching')}
        subtitle={t('Import the bank statement (CSV with date, description, amount or debit and credit). Lines match our books by amount and date.')}
        actions={
          <div className="flex gap-2">
            <label className="btn-primary cursor-pointer">
              {t('Import statement')}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <Button tone="secondary" onClick={() => void r.run(async () => { const x = await api<{ matched: number }>('/finance/bank/auto-match', { body: {} }); r.setMsg({ ok: true, text: t('{matched} matched', { matched: x.matched }) }); }, 'Done')}>{t('Match again')}</Button>
          </div>
        }
      />
      {r.view}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-caption text-text-muted">{t('Bank in our books')}</p><p className="text-h3">{egp(rec.data.bookBalance)}</p></Card>
        <Card><p className="text-caption text-text-muted">{t('Statement lines not matched')}</p><p className="text-h3">{open.length}</p></Card>
        <Card><p className="text-caption text-text-muted">{t('Book lines not on a statement')}</p><p className="text-h3">{rec.data.unmatchedBook.length}</p></Card>
      </div>
      <Card title={t('Statement')}>
        {rec.data.lines.length === 0 ? <Empty>{t('No statement imported yet')}</Empty> : (
          <Table head={[t('Date'), t('Description'), t('Amount'), t('In our books'), '']}>
            {rec.data.lines.map((l) => {
              const candidates = rec.data!.unmatchedBook.filter((b) => b.amount === l.amount);
              return (
                <tr key={l.id}>
                  <Td><span className="ltr-iso">{l.date}</span></Td>
                  <Td>{l.description}{l.reference && <div className="ltr-iso text-caption text-text-muted">{l.reference}</div>}</Td>
                  <Td><span className={`font-bold ${l.amount < 0 ? 'text-danger' : ''}`}>{egp(l.amount)}</span></Td>
                  <Td>{l.matched ? <span className="text-caption"><Badge tone="green">{t('Matched')}</Badge> #{l.matched.number} {l.matched.memo}</span> : <Badge tone="amber">{t('Not matched')}</Badge>}</Td>
                  <Td>
                    {l.matched ? (
                      <Button tone="ghost" onClick={() => void r.call(`/finance/bank/${l.id}/unmatch`, {}, 'Done')}>{t('Undo')}</Button>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {candidates.map((c) => (
                          <Button key={c.id} tone="secondary" onClick={() => void r.call(`/finance/bank/${l.id}/match`, { journalLineId: c.id }, 'Matched')}>#{c.number} <span className="ltr-iso">{c.date}</span></Button>
                        ))}
                        <Select value={bookAs[l.id] ?? ''} onChange={(e) => setBookAs({ ...bookAs, [l.id]: e.target.value })}>
                          <option value="">{t('Book to account')}</option>
                          {plain.map((a) => <option key={a.code} value={a.code}>{a.code} · {locale === 'ar' ? a.nameAr : a.name}</option>)}
                        </Select>
                        {bookAs[l.id] && <Button onClick={() => void r.call(`/finance/bank/${l.id}/book`, { accountCode: bookAs[l.id] }, 'Booked and matched')}>{t('Book')}</Button>}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Card title={t('In our books, not on a statement yet')}>
        {rec.data.unmatchedBook.length === 0 ? <Empty>{t('Everything is matched')}</Empty> : (
          <Table head={['#', t('Date'), t('What'), t('Amount')]}>
            {rec.data.unmatchedBook.map((b) => (
              <tr key={b.id}><Td><span className="ltr-iso">{b.number}</span></Td><Td><span className="ltr-iso">{b.date}</span></Td><Td>{b.memo}</Td><Td>{egp(b.amount)}</Td></tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
