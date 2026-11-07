'use client';
import Link from 'next/link';
import { StatCard } from '@/components/StatCard';
import { Alert, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface Inbox {
  payoutsToApprove: number;
  payoutsYouCanApprove: number;
  payoutsToPay: number;
  withdrawals: number;
  payIns: number;
  deposits: number;
  settlements: number;
  expenses: number;
  journals: number;
  bankChanges: { merchantId: string; name: string; mine: boolean }[];
  closedThrough: string;
  balanced: boolean;
}
interface Row { code: string; name: string; nameAr: string; type: string; balance: number }
interface Sheet { assets: Row[]; liabilities: Row[]; totalAssets: number; totalLiabilities: number; balanced: boolean }
interface Pnl { from: string; to: string; totalIncome: number; totalExpenses: number; profit: number }
interface Aging {
  merchants: { merchantId: string; name: string; '0_3': number; '4_7': number; '8_14': number; '15_plus': number; total: number }[];
  couriers: { courierId: string; name: string; amount: number; since: string | null; bucket: string }[];
}

export default function MoneyOverview() {
  const t = useT();
  const locale = useLocale();
  const inbox = useLoad<Inbox>('/finance/inbox');
  const sheet = useLoad<Sheet>('/finance/reports/balance-sheet');
  const pnl = useLoad<Pnl>('/finance/reports/profit-and-loss');
  const aging = useLoad<Aging>('/finance/reports/cod-aging');
  if (!inbox.data || !sheet.data || !pnl.data || !aging.data) {
    const err = inbox.error ?? sheet.error ?? pnl.error ?? aging.error;
    return err ? <Alert>{err}</Alert> : <Loading />;
  }
  const bal = (code: string) => [...sheet.data!.assets, ...sheet.data!.liabilities].find((r) => r.code === code)?.balance ?? 0;
  const i = inbox.data;
  const tasks = [
    { n: i.payoutsYouCanApprove, label: 'Payouts to approve', href: '/admin/money/payouts' },
    { n: i.payoutsToPay, label: 'Payouts approved, to pay', href: '/admin/money/payouts' },
    { n: i.bankChanges.filter((b) => !b.mine).length, label: 'Merchant bank changes to approve', href: '/admin/money/payouts' },
    { n: i.payIns, label: 'Fawry pay ins to check', href: '/admin/money/couriers' },
    { n: i.withdrawals, label: 'Courier withdrawals', href: '/admin/money/couriers' },
    { n: i.deposits, label: 'Safe deposits to confirm', href: '/admin/money/safes' },
    { n: i.settlements, label: 'Agent settlements open', href: '/admin/money/agents' },
    { n: i.expenses, label: 'Expenses to approve', href: '/admin/money/expenses' },
    { n: i.journals, label: 'Journals to approve', href: '/admin/money/books' },
  ].filter((x) => x.n > 0);
  const name = (r: { name: string; nameAr: string }) => (locale === 'ar' ? r.nameAr : r.name);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('Money')} title={t('Money overview')} subtitle={i.closedThrough ? t('Books closed through {date}', { date: i.closedThrough }) : t('Books are open')} />
      {!i.balanced && <Alert>{t('The books do not balance. Call the developer before posting anything else.')}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Bank')} value={egp(bal('1000'))} icon="wallet" />
        <StatCard label={t('In hub safes')} value={egp(bal('1100'))} icon="invoice" tone="in-progress" />
        <StatCard label={t('Cash with couriers')} value={egp(bal('1200'))} icon="courier" tone="needs-action" />
        <StatCard label={t('Owed to merchants')} value={egp(bal('2100'))} icon="store" tone="returning" />
        <StatCard label={t('Courier wallets')} value={egp(bal('2200'))} icon="cash" />
        <StatCard label={t('Owed to agents')} value={egp(bal('2300'))} icon="points" />
        <StatCard label={t('Revenue this month')} value={egp(pnl.data.totalIncome)} icon="analytics" tone="delivered" />
        <StatCard label={t('Profit this month')} value={egp(pnl.data.profit)} icon="analytics" tone={pnl.data.profit >= 0 ? 'delivered' : 'needs-action'} />
      </div>
      <Card title={t('Waiting for finance')}>
        {tasks.length === 0 ? (
          <Empty>{t('Nothing is waiting')}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((x) => (
              <li key={x.label} className="flex items-center justify-between py-2.5">
                <Link href={x.href} className="font-semibold text-link">{t(x.label)}</Link>
                <span className="tabular ltr-iso rounded-pill bg-selected-bg px-2.5 py-0.5 font-bold">{x.n}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('Cash still with couriers')}>
          {aging.data.couriers.length === 0 ? (
            <Empty>{t('All cash is handed in')}</Empty>
          ) : (
            <Table head={[t('Courier'), t('Amount'), t('Since')]}>
              {aging.data.couriers.map((c) => (
                <tr key={c.courierId}>
                  <Td>{c.name}</Td>
                  <Td>{egp(c.amount)}</Td>
                  <Td>{c.since ? dateTime(c.since) : ''}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={t('Merchant money by age')}>
          {aging.data.merchants.length === 0 ? (
            <Empty>{t('Nothing owed to merchants')}</Empty>
          ) : (
            <Table head={[t('Merchant'), t('0 to 3 days'), t('4 to 7'), t('8 to 14'), t('15+'), t('Total')]}>
              {aging.data.merchants.map((m) => (
                <tr key={m.merchantId}>
                  <Td>{m.name}</Td>
                  <Td>{egp(m['0_3'])}</Td>
                  <Td>{egp(m['4_7'])}</Td>
                  <Td>{egp(m['8_14'])}</Td>
                  <Td>{m['15_plus'] ? <span className="font-bold text-danger">{egp(m['15_plus'])}</span> : egp(0)}</Td>
                  <Td><span className="font-bold">{egp(m.total)}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Card title={t('Balances')}>
        <Table head={[t('Account'), t('Balance')]}>
          {[...sheet.data.assets, ...sheet.data.liabilities].filter((r) => r.balance !== 0).map((r) => (
            <tr key={r.code}>
              <Td><span className="ltr-iso text-text-muted">{r.code}</span> {name(r)}</Td>
              <Td>{egp(r.balance)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
