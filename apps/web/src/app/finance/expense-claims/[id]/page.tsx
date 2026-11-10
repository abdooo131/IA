import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { ClaimActions } from '@/components/finance/ClaimActions';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { FinanceClaimPage } from '@/lib/my-pay-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/**
 * One employee expense claim: its receipt, the person, the manager's approval and the entry
 * once paid; Accounting pays it from a bank or cash box (balance shown) or refuses it.
 */
export default async function ExpenseClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, page, profile, me] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/expense_claim/${id}`),
    apiGet<FinanceClaimPage>(`/finance/expense-claims/${id}`),
    getMyProfile(),
    getCurrentUser(),
  ]);
  const approverIsMe =
    doc.data.secondPerson === true && !!me && doc.data.managerDecidedById === me.id;
  return (
    <DocumentPage
      doc={doc}
      actions={
        doc.actions.includes('pay') ? (
          <ClaimActions
            page={page}
            canUse={canDo(profile, 'accounting', 'use')}
            meId={me?.id ?? null}
            approverIsMe={approverIsMe}
          />
        ) : undefined
      }
    />
  );
}
