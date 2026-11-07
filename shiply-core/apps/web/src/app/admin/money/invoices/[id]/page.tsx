'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { InvoiceView, type Invoice } from '@/components/InvoiceView';
import { Alert, Button, Loading } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

export default function AdminInvoice() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const inv = useLoad<Invoice>(`/finance/invoices/${id}`);
  if (!inv.data) return inv.error ? <Alert>{inv.error}</Alert> : <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/admin/money/invoices" className="text-body-sm font-bold text-link">← {t('Tax invoices')}</Link>
        <Button tone="secondary" onClick={() => window.print()}>{t('Print')}</Button>
      </div>
      <InvoiceView inv={inv.data} />
    </div>
  );
}
