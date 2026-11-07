'use client';
import { useState } from 'react';
import { useMe } from '@/components/Shell';
import { RequestBadge, toPiastres, useRunner } from '@/components/money';
import { Alert, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { api } from '@/lib/api';
import { egp, todayCairo } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface Row { code: string; name: string; nameAr: string; type: string; debit: number; credit: number; balance: number }
interface Account { code: string; name: string; nameAr: string; type: string; party: string | null }
interface Entry { id: string; number: number; date: string; memo: string; source: string; lines: { id: string; accountCode: string; partyType: string | null; debit: number; credit: number; memo: string }[] }
interface Draft { id: string; date: string; memo: string; status: string; createdById: string; lines: { account: string; debit: number; credit: number }[] }

const TABS = ['Profit and loss', 'Balance sheet', 'Trial balance', 'Journal', 'Manual journal', 'Close the books'] as const;

function Statement({ rows, total, label }: { rows: Row[]; total: number; label: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div>
      <Table head={[t('Account'), t('Amount')]}>
        {rows.filter((r) => r.balance !== 0).map((r) => (
          <tr key={r.code}><Td><span className="ltr-iso text-text-muted">{r.code}</span> {locale === 'ar' ? r.nameAr : r.name}</Td><Td>{egp(r.balance)}</Td></tr>
        ))}
      </Table>
      <div className="flex justify-between border-t border-line px-3 py-2 font-bold"><span>{label}</span><span>{egp(total)}</span></div>
    </div>
  );
}

function Pnl() {
  const t = useT();
  const [from, setFrom] = useState(`${todayCairo().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayCairo());
  const p = useLoad<{ income: Row[]; expenses: Row[]; totalIncome: number; totalExpenses: number; profit: number }>(`/finance/reports/profit-and-loss?from=${from}&to=${to}`);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ltr-iso w-44" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ltr-iso w-44" />
      </div>
      {!p.data ? <Loading /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Statement rows={p.data.income} total={p.data.totalIncome} label={t('Total income')} />
          <Statement rows={p.data.expenses} total={p.data.totalExpenses} label={t('Total expenses')} />
          <div className="flex justify-between rounded-lg bg-selected-bg px-4 py-3 text-h3 lg:col-span-2"><span>{t('Profit')}</span><span className={p.data.profit < 0 ? 'text-danger' : ''}>{egp(p.data.profit)}</span></div>
        </div>
      )}
    </div>
  );
}

function Sheet() {
  const t = useT();
  const [through, setThrough] = useState(todayCairo());
  const b = useLoad<{ assets: Row[]; liabilities: Row[]; equity: Row[]; earnings: number; totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean }>(`/finance/reports/balance-sheet?through=${through}`);
  return (
    <div className="space-y-4">
      <Input type="date" value={through} onChange={(e) => setThrough(e.target.value)} className="ltr-iso w-44" />
      {!b.data ? <Loading /> : (
        <>
          {!b.data.balanced && <Alert>{t('Assets do not equal liabilities plus equity')}</Alert>}
          <div className="grid gap-5 lg:grid-cols-2">
            <Statement rows={b.data.assets} total={b.data.totalAssets} label={t('Total assets')} />
            <div className="space-y-4">
              <Statement rows={b.data.liabilities} total={b.data.totalLiabilities} label={t('Total liabilities')} />
              <Statement rows={[...b.data.equity, { code: '', name: 'Profit to date', nameAr: 'الأرباح حتى تاريخه', type: 'EQUITY', debit: 0, credit: 0, balance: b.data.earnings }]} total={b.data.totalEquity} label={t('Total equity')} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Trial() {
  const t = useT();
  const locale = useLocale();
  const tb = useLoad<{ rows: Row[]; debit: number; credit: number; balanced: boolean }>('/finance/reports/trial-balance');
  if (!tb.data) return <Loading />;
  return (
    <div className="space-y-3">
      {tb.data.balanced ? <Alert tone="success">{t('Debits equal credits')}</Alert> : <Alert>{t('The trial balance does not balance')}</Alert>}
      <Table head={[t('Account'), t('Debit'), t('Credit')]}>
        {tb.data.rows.map((r) => (
          <tr key={r.code}><Td><span className="ltr-iso text-text-muted">{r.code}</span> {locale === 'ar' ? r.nameAr : r.name}</Td><Td>{egp(r.debit)}</Td><Td>{egp(r.credit)}</Td></tr>
        ))}
        <tr className="font-bold"><Td>{t('Total')}</Td><Td>{egp(tb.data.debit)}</Td><Td>{egp(tb.data.credit)}</Td></tr>
      </Table>
    </div>
  );
}

function Journal({ accounts }: { accounts: Account[] }) {
  const t = useT();
  const [account, setAccount] = useState('');
  const j = useLoad<Entry[]>(`/finance/journal${account ? `?account=${account}` : ''}`);
  const name = (code: string) => accounts.find((a) => a.code === code)?.name ?? code;
  return (
    <div className="space-y-3">
      <Select value={account} onChange={(e) => setAccount(e.target.value)}>
        <option value="">{t('All accounts')}</option>
        {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
      </Select>
      {!j.data ? <Loading /> : j.data.length === 0 ? <Empty>{t('No entries')}</Empty> : (
        <Table head={['#', t('Date'), t('What'), t('Account'), t('Debit'), t('Credit')]}>
          {j.data.flatMap((e) =>
            e.lines.map((l, i) => (
              <tr key={l.id} className={i === 0 ? 'border-t-2 border-line' : ''}>
                <Td>{i === 0 ? <span className="ltr-iso">{e.number}</span> : ''}</Td>
                <Td>{i === 0 ? <span className="ltr-iso">{e.date}</span> : ''}</Td>
                <Td>{i === 0 ? e.memo : <span className="text-caption text-text-muted">{l.memo}</span>}</Td>
                <Td><span className="ltr-iso text-text-muted">{l.accountCode}</span> {name(l.accountCode)}</Td>
                <Td>{l.debit ? egp(l.debit) : ''}</Td>
                <Td>{l.credit ? egp(l.credit) : ''}</Td>
              </tr>
            )),
          )}
        </Table>
      )}
    </div>
  );
}

function ManualJournal({ accounts }: { accounts: Account[] }) {
  const t = useT();
  const me = useMe();
  const drafts = useLoad<Draft[]>('/finance/journals/drafts');
  const r = useRunner(() => drafts.reload());
  const plain = accounts.filter((a) => !a.party);
  const empty = () => ({ account: plain[0]?.code ?? '1000', debit: '', credit: '' });
  const [date, setDate] = useState(todayCairo());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([empty(), { ...empty(), account: '3000' }]);
  const set = (i: number, k: 'account' | 'debit' | 'credit', v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="space-y-4">
      {r.view}
      <p className="text-body-sm text-text-muted">{t('For opening balances and corrections. Wallet accounts (merchants, couriers, agents, hubs) are changed through their own screens.')}</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void r.run(async () => {
            const body = { date, memo, lines: lines.map((l) => ({ account: l.account, debit: l.debit ? toPiastres(l.debit) : 0, credit: l.credit ? toPiastres(l.credit) : 0 })) };
            await api('/finance/journals', { body });
            setMemo('');
            setLines([empty(), { ...empty(), account: '3000' }]);
          }, 'Journal saved. Someone else must approve it');
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ltr-iso w-44" />
          <Input required minLength={3} placeholder={t('What is this entry for?')} value={memo} onChange={(e) => setMemo(e.target.value)} className="flex-1" />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-3 gap-2">
            <Select value={l.account} onChange={(e) => set(i, 'account', e.target.value)}>
              {plain.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </Select>
            <Input inputMode="decimal" placeholder={t('Debit')} className="ltr-iso" value={l.debit} onChange={(e) => set(i, 'debit', e.target.value)} />
            <Input inputMode="decimal" placeholder={t('Credit')} className="ltr-iso" value={l.credit} onChange={(e) => set(i, 'credit', e.target.value)} />
          </div>
        ))}
        <div className="flex gap-2">
          <Button tone="ghost" onClick={() => setLines([...lines, empty()])}>{t('Add line')}</Button>
          <Button type="submit">{t('Save journal')}</Button>
        </div>
      </form>
      {(drafts.data ?? []).length > 0 && (
        <Table head={[t('Date'), t('What'), t('Amount'), t('Status'), '']}>
          {drafts.data!.map((d) => (
            <tr key={d.id}>
              <Td><span className="ltr-iso">{d.date}</span></Td>
              <Td>{d.memo}</Td>
              <Td>{egp(d.lines.reduce((n, l) => n + l.debit, 0))}</Td>
              <Td><RequestBadge status={d.status} posted /></Td>
              <Td>
                {d.status === 'PENDING_APPROVAL' && (d.createdById === me.id ? <span className="text-caption text-text-muted">{t('Someone else approves')}</span> : (
                  <div className="flex gap-1">
                    <Button onClick={() => void r.call(`/finance/journals/${d.id}/approve`, {}, 'Posted')}>{t('Approve')}</Button>
                    <Button tone="ghost" onClick={() => void r.call(`/finance/journals/${d.id}/reject`, {}, 'Rejected')}>{t('Reject')}</Button>
                  </div>
                ))}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Close() {
  const t = useT();
  const inbox = useLoad<{ closedThrough: string }>('/finance/inbox');
  const r = useRunner(() => inbox.reload());
  const yesterday = new Date(Date.now() - 22 * 3600e3).toISOString().slice(0, 10);
  const [date, setDate] = useState(yesterday);
  return (
    <div className="space-y-3">
      {r.view}
      <p className="text-body-sm">{inbox.data?.closedThrough ? t('Books are closed through {date}', { date: inbox.data.closedThrough }) : t('Books are open')}</p>
      <p className="text-body-sm text-text-muted">{t('Closing a day stops anything being posted on or before it. Do it each morning for the day before, after the cash is counted.')}</p>
      <Field label={t('Close through')}>
        <div className="flex gap-2">
          <Input type="date" value={date} max={yesterday} onChange={(e) => setDate(e.target.value)} className="ltr-iso w-44" />
          <Button onClick={() => { if (window.confirm(t('Close the books through {date}? This cannot be undone.', { date }))) void r.call('/finance/close', { date }, 'Books closed'); }}>{t('Close')}</Button>
        </div>
      </Field>
    </div>
  );
}

export default function BooksPage() {
  const t = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Profit and loss');
  const accounts = useLoad<Account[]>('/finance/accounts');
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('Money')} title={t('Books and reports')} subtitle={t('Every movement of money, double entry, append only')} />
      <div className="flex flex-wrap gap-1">
        {TABS.map((x) => (
          <button key={x} type="button" onClick={() => setTab(x)} className={`min-h-9 rounded-pill px-3 text-body-sm font-semibold ${tab === x ? 'bg-primary text-on-primary' : 'bg-surface text-text hover:bg-surface-raised'}`}>{t(x)}</button>
        ))}
      </div>
      <Card>
        {tab === 'Profit and loss' && <Pnl />}
        {tab === 'Balance sheet' && <Sheet />}
        {tab === 'Trial balance' && <Trial />}
        {tab === 'Journal' && (accounts.data ? <Journal accounts={accounts.data} /> : <Loading />)}
        {tab === 'Manual journal' && (accounts.data ? <ManualJournal accounts={accounts.data} /> : <Loading />)}
        {tab === 'Close the books' && <Close />}
      </Card>
    </div>
  );
}
