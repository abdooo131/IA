'use client';
import Link from 'next/link';
import { Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Row { id: string; number: string; kind: string; month: string; net: number; vat: number; total: number; status: string }

/** The merchant's monthly tax invoices and credit notes. */
export default function MerchantInvoices() {
  const t = useT();
  const list = useLoad<Row[]>('/merchant/invoices');
  if (!list.data) return <Loading />;
  const rows = list.data.filter((x) => x.status === 'ISSUED');
  return (
    <div className="space-y-5">
      <PageHeader title={t('Tax invoices')} subtitle={t('Our monthly tax invoice for the delivery services, with VAT')} />
      <Card>
        {rows.length === 0 ? <Empty>{t('No invoices yet')}</Empty> : (
          <Table head={[t('Number'), t('Month'), t('Kind'), t('Before VAT'), t('VAT'), t('Total')]}>
            {rows.map((x) => (
              <tr key={x.id}>
                <Td><Link href={`/merchant/invoices/${x.id}`} className="ltr-iso font-bold text-link">{x.number}</Link></Td>
                <Td><span className="ltr-iso">{x.month}</span></Td>
                <Td>{x.kind === 'CREDIT_NOTE' ? t('Credit note') : t('Invoice')}</Td>
                <Td>{egp(x.net)}</Td>
                <Td>{egp(x.vat)}</Td>
                <Td><span className="font-bold">{egp(x.total)}</span></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
