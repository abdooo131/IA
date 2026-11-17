import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { CancelBill, PayBill } from '@/components/finance/Payables';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BillRow, BookAccount, RiderOfficeDetail } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** One supplier bill: its amounts, payments and entries; pay it (in parts) or cancel it. */
export default async function FinanceBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/bill/${id}`),
    getMyProfile(),
  ]);
  let actions = null;
  if (doc.status === 'open' && canDo(profile, 'accounting', 'use')) {
    const [bills, accounts] = await Promise.all([
      apiGet<BillRow[]>(`/finance/bills?status=open&supplierId=${String(doc.data.supplierId)}`),
      apiGet<BookAccount[]>('/finance/accounts'),
    ]);
    const bill = bills.find((b) => b.id === id);
    // A rider office's bill: what the office owes us (its riders' shortages) is set off.
    const office = bill?.officeMonth
      ? await apiGet<RiderOfficeDetail>(`/finance/rider-offices/${bill.supplier.id}`)
      : null;
    if (bill)
      actions = (
        <div className="space-y-4">
          <PayBill
            bill={bill}
            money={accounts.filter((a) => a.money && a.isActive)}
            owesUs={office?.wallet.owesUsPiastres ?? 0}
          />
          {bill.paidPiastres === 0 && !bill.officeMonth && <CancelBill bill={bill} />}
        </div>
      );
  }
  return <DocumentPage doc={doc} actions={actions} />;
}
