import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { EditSupplier } from '@/components/finance/Payables';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** One supplier: its details (edited here), what we owe them and its bills, payments and orders. */
export default async function FinanceSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/supplier/${id}`),
    getMyProfile(),
  ]);
  let actions = null;
  if (canDo(profile, 'accounting', 'use')) {
    const accounts = await apiGet<BookAccount[]>('/finance/accounts');
    const d = doc.data;
    actions = (
      <EditSupplier
        supplier={{
          id: doc.id,
          name: String(d.name ?? ''),
          taxId: typeof d.taxId === 'string' ? d.taxId : null,
          phone: typeof d.phone === 'string' ? d.phone : null,
          email: typeof d.email === 'string' ? d.email : null,
          whtBp: Number(d.whtBp ?? 0),
          defaultExpenseAccountId:
            typeof d.defaultExpenseAccountId === 'string' ? d.defaultExpenseAccountId : null,
          isActive: d.isActive === true,
        }}
        expenses={accounts.filter((a) => [5400, 5500].includes(a.groupCode) && a.isActive)}
      />
    );
  }
  return <DocumentPage doc={doc} actions={actions} />;
}
