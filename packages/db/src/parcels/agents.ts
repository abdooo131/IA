// Agents (the companies that supply Shiply's couriers and hub staff) are suppliers in Accounting
// (docs/MERGE.md step 6): what we owe an agent is their supplier account, and an approved monthly
// settlement becomes a supplier bill that Accounting pays like any other bill.
import type { Prisma } from '@prisma/client';
import { cairoDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { nextNumber, systemAccountId } from '../finance/ledger';

type Tx = Prisma.TransactionClient;

/** The person a record is made by when no one is named (a background job): the first admin. */
async function someAdmin(tx: Tx) {
  const admin = await tx.user.findFirst({
    where: { role: 'admin' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) throw new DomainError('no_admin', 409);
  return admin.id;
}

/**
 * The agent's supplier: made the first time it is needed (the agent opened, a settlement
 * approved, an advance paid) from the agent's details, or an existing supplier of the same
 * name that no other agent uses. Returns the supplier id.
 */
export async function ensureAgentSupplier(db: Db, agentId: string, actorUserId?: string | null) {
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT id FROM agents WHERE id = ${agentId} FOR UPDATE`;
    const agent = await tx.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new DomainError('agent_not_found', 404);
    if (agent.supplierId) return agent.supplierId;
    const actor = actorUserId ?? (await someAdmin(tx));
    const same = await tx.supplier.findFirst({
      where: { name: { equals: agent.name.trim(), mode: 'insensitive' }, agent: null },
    });
    const commission = await systemAccountId(tx, 'parcel_agent_commission');
    const supplier =
      same ??
      (await tx.supplier.create({
        data: {
          name: agent.name.trim(),
          taxId: agent.taxCardNo || null,
          phone: agent.phone || null,
          email: agent.email || null,
          whtBp: 0,
          defaultExpenseAccountId: commission,
          createdById: actor,
        },
      }));
    await tx.agent.update({ where: { id: agent.id }, data: { supplierId: supplier.id } });
    await recordAudit(tx, {
      actorUserId: actor,
      action: 'finance.supplier_create',
      entityType: 'supplier',
      entityId: supplier.id,
      after: { name: supplier.name, agentId: agent.id, agentCode: agent.code },
    });
    return supplier.id;
  });
}

/**
 * The supplier bill of an approved agent settlement. The settlement's own entry already booked
 * the costs against the agent's supplier account, so the bill records that entry rather than
 * posting again; advances already paid to the agent count as paid on it.
 */
export async function billAgentSettlement(
  tx: Tx,
  input: { settlementId: string; entryId: string; actorUserId: string },
) {
  const x = await tx.agentSettlement.findUnique({
    where: { id: input.settlementId },
    omit: { invoice: true },
  });
  if (!x) throw new DomainError('settlement_not_found', 404);
  if (x.billId) return tx.bill.findUniqueOrThrow({ where: { id: x.billId } });
  if (x.total <= 0) return null; // the agent owes us this month: nothing to bill
  const supplierId = await ensureAgentSupplier(tx, x.agentId, input.actorUserId);
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const expenseAccountId = await systemAccountId(tx, 'parcel_agent_commission');
  const paid = Math.min(x.advances, x.total);
  const day = new Date(`${cairoDay(new Date())}T00:00:00Z`);
  const bill = await tx.bill.create({
    data: {
      number: await nextNumber(tx, 'bills'),
      supplierId,
      reference: x.code,
      billDate: day,
      dueDate: day,
      expenseAccountId,
      netPiastres: x.total,
      vatPiastres: 0,
      totalPiastres: x.total,
      whtBp: supplier.whtBp,
      paidPiastres: paid,
      status: paid === x.total ? 'paid' : 'open',
      memo: `Agent settlement ${x.code} for ${x.month}`,
      entryId: input.entryId,
      createdById: input.actorUserId,
    },
  });
  await tx.agentSettlement.update({
    where: { id: x.id },
    data: {
      billId: bill.id,
      ...(bill.status === 'paid' ? { status: 'PAID', paidAt: new Date() } : {}),
    },
  });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'finance.bill_create',
    entityType: 'bill',
    entityId: bill.id,
    after: { settlement: x.code, total: x.total, advances: paid },
  });
  return bill;
}

/** Before a bill is paid: a settlement bill needs the agent's own invoice first. */
export async function assertAgentInvoice(tx: Tx, billId: string) {
  const x = await tx.agentSettlement.findUnique({
    where: { billId },
    select: { invoiceName: true },
  });
  if (x && !x.invoiceName) throw new DomainError('agent_invoice_missing');
}

/** Once its bill is fully paid, the settlement is paid too. */
export async function markSettlementPaid(tx: Tx, billId: string) {
  await tx.agentSettlement.updateMany({
    where: { billId, status: { not: 'PAID' } },
    data: { status: 'PAID', paidAt: new Date() },
  });
}
