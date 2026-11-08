// Shiply's packaging shop (docs/MERGE.md step 6): packaging sold to merchants who ship next day,
// kept at the sorting facilities. Goods bought for it arrive on a purchase order; what arrived
// becomes a supplier bill that Accounting pays like any bill.
import type { Prisma } from '@prisma/client';
import { cairoDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { DomainError } from '../domain-error';
import { nextNumber, post, systemAccountId } from '../finance/ledger';

type Tx = Prisma.TransactionClient;

/**
 * Goods received on a shop purchase order: packaging stock goes up for Shiply (company shiply)
 * against the supplier, with VAT claimed back, and a supplier bill records that entry.
 */
export async function billShopGoods(
  tx: Tx,
  input: {
    supplierId: string;
    /** The purchase order's code and the delivery (one bill per delivery) */
    reference: string;
    netPiastres: number;
    vatPiastres: number;
    dueDate?: string | null;
    memo: string;
    actorUserId: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isSafeInteger(input.netPiastres) || input.netPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw new DomainError('supplier_not_found', 404);
  const total = input.netPiastres + input.vatPiastres;
  const entry = await post(tx, {
    kind: 'parcels.shop_goods_received',
    idempotencyKey: `parcels:shop_goods:${input.idempotencyKey}`,
    occurredAt: new Date(),
    createdById: input.actorUserId,
    memo: input.memo,
    company: 'shiply',
    lines: [
      { account: { type: 'packaging_stock' }, amount: input.netPiastres },
      { account: { type: 'vat_payable' }, amount: input.vatPiastres },
      { account: { type: 'supplier', supplierId: supplier.id }, amount: -total },
    ],
  });
  const today = cairoDay(new Date());
  const due = input.dueDate && input.dueDate >= today ? input.dueDate : today;
  const bill = await tx.bill.create({
    data: {
      number: await nextNumber(tx, 'bills'),
      supplierId: supplier.id,
      reference: input.reference,
      billDate: new Date(`${today}T00:00:00Z`),
      dueDate: new Date(`${due}T00:00:00Z`),
      expenseAccountId: await systemAccountId(tx, 'packaging_stock'),
      netPiastres: input.netPiastres,
      vatPiastres: input.vatPiastres,
      totalPiastres: total,
      whtBp: supplier.whtBp,
      memo: input.memo,
      entryId: entry!.id,
      createdById: input.actorUserId,
    },
  });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'finance.bill_create',
    entityType: 'bill',
    entityId: bill.id,
    after: { reference: input.reference, total },
  });
  return bill;
}
