import {
  addDays,
  cairoDay,
  cairoDayStart,
  JOB_ROLE_TEMPLATES,
  monthEnd,
  nextPayoutDay,
  shiftDayByMonths,
} from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAccess } from '../src/access';
import {
  createRecurring,
  createSupplier,
  decideFinanceRequest,
  dueGroupOf,
  ensureDefaultAccounts,
  loanDetail,
  listLoans,
  payBill,
  paymentsDue,
  payTax,
  post,
  recordBill,
  recordCapital,
  runRecurring,
  submitLoan,
} from '../src/finance';
import { setSalaryPackage } from '../src/hr-pay';
import {
  dispatchPush,
  type PushMessage,
  type PushOutcome,
  type PushSender,
  type PushTarget,
} from '../src/push';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

class FakePush implements PushSender {
  enabled = true;
  sent: { endpoint: string; message: PushMessage }[] = [];
  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ endpoint: target.endpoint, message });
    return 'sent';
  }
}

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let second: string;
let n = 0;
const key = () => `due-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());
const month = () => today().slice(0, 7);

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  const user = (email: string) =>
    prisma.user.create({ data: { email, name: email, role: 'admin', passwordHash: 'x' } });
  admin = (await user('a@t.eg')).id;
  second = (await user('b@t.eg')).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    day: addDays(today(), -90),
    actorUserId: admin,
    idempotencyKey: key(),
  });
  await setSetting(prisma, { key: 'finance.approve_money_in', value: 0, actorUserId: null });
});

afterAll(() => prisma.$disconnect());

async function bills() {
  const supplier = await createSupplier(prisma, {
    name: 'Landlord',
    defaultExpenseAccountId: (await byKey('expense:maintenance')).id,
    actorUserId: admin,
  });
  const storeBill = await recordBill(prisma, {
    supplierId: supplier.id,
    reference: 'R-1',
    billDate: addDays(today(), -10),
    dueDate: addDays(today(), 3),
    netPiastres: 50_000,
    darkStoreId: f.other.id,
    actorUserId: admin,
    idempotencyKey: key(),
  });
  await payBill(prisma, {
    billId: storeBill.id,
    amountPiastres: 10_000,
    moneyAccountId: (await byKey('bank')).id,
    reference: 'Part',
    actorUserId: admin,
    idempotencyKey: key(),
  });
  const lateBill = await recordBill(prisma, {
    supplierId: supplier.id,
    reference: 'R-2',
    billDate: addDays(today(), -20),
    dueDate: addDays(today(), -5),
    netPiastres: 70_000,
    actorUserId: admin,
    idempotencyKey: key(),
  });
  return { storeBill, lateBill };
}

describe('paymentsDue', () => {
  it('lists bills, loans, salaries, taxes, payouts and recurring expenses on their days', async () => {
    const { storeBill, lateBill } = await bills();

    // A loan whose first instalment was due ten days ago.
    await submitLoan(prisma, {
      lender: 'bank',
      lenderName: 'National Bank of Egypt',
      principalPiastres: 1_200_000,
      moneyAccountId: (await byKey('bank')).id,
      startDay: addDays(today(), -40),
      annualRateBp: 1_200,
      months: 12,
      firstPaymentDay: addDays(today(), -10),
      reference: 'NBE-77',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const loan = await loanDetail(prisma, (await listLoans(prisma))[0]!.id);

    // An employee on the payroll with a salary package.
    const person = await prisma.user.create({
      data: { email: 'e@t.eg', name: 'E', role: 'admin', passwordHash: 'x' },
    });
    const employee = await prisma.employee.create({
      data: { userId: person.id, nameEn: 'E', homeStoreId: f.store.id },
    });
    await setSalaryPackage(prisma, {
      employeeId: employee.id,
      body: { basicPiastres: 800_000, allowances: [] },
      actorUserId: admin,
    });

    // VAT: 30,000 owed before this month, 20,000 this month, 10,000 paid this month.
    const bank = { type: 'bank' as const };
    await post(prisma, {
      kind: 'test_vat',
      idempotencyKey: key(),
      occurredAt: new Date(cairoDayStart(`${month()}-01`).getTime() - 86_400_000),
      lines: [
        { account: bank, amount: 30_000 },
        { account: { type: 'vat_payable' }, amount: -30_000 },
      ],
    });
    await post(prisma, {
      kind: 'test_vat',
      idempotencyKey: key(),
      lines: [
        { account: bank, amount: 20_000 },
        { account: { type: 'vat_payable' }, amount: -20_000 },
      ],
    });
    await payTax(prisma, {
      tax: 'vat',
      amountPiastres: 10_000,
      moneyAccountId: (await byKey('bank')).id,
      reference: 'ETA',
      day: today(),
      actorUserId: admin,
      idempotencyKey: key(),
    });

    // A merchant owed 25,000.
    await post(prisma, {
      kind: 'test_cod',
      idempotencyKey: key(),
      lines: [
        { account: bank, amount: 25_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -25_000 },
      ],
    });

    // Rent on the 1st of every month from this one.
    const rent = await createRecurring(prisma, {
      name: 'Rent',
      expense: {
        expenseAccountId: (await byKey('expense:maintenance')).id,
        paidFromAccountId: (await byKey('bank')).id,
        amountPiastres: 400_000,
        memo: 'Rent',
        reference: 'Rent',
      },
      dayOfMonth: 1,
      startMonth: month(),
      actorUserId: admin,
    });

    const due = await paymentsDue(prisma, new Date(), { stores: null, days: 90 });
    const item = (k: string) => due.items.find((i) => i.key === k);

    expect(item(`bill:${storeBill.id}`)).toMatchObject({
      kind: 'bill',
      label: 'BILL-000001',
      counterparty: 'Landlord',
      amountPiastres: 40_000,
      dueDay: addDays(today(), 3),
      href: `/finance/bills/${storeBill.id}`,
      darkStoreId: f.other.id,
    });
    expect(item(`bill:${lateBill.id}`)).toMatchObject({
      amountPiastres: 70_000,
      dueDay: addDays(today(), -5),
    });

    const first = loan.instalments[0]!;
    const loanRow = await prisma.loanInstalment.findFirstOrThrow({ where: { seq: 1 } });
    expect(item(`loan:${loanRow.id}`)).toMatchObject({
      kind: 'loan',
      label: 'LN-000001 #1',
      counterparty: 'National Bank of Egypt',
      amountPiastres: first.instalmentPiastres,
      dueDay: first.dueDay,
      href: `/finance/loans/${loan.id}`,
    });
    // Instalments due in the window, the first one overdue.
    const loanItems = due.items.filter((i) => i.kind === 'loan');
    expect(loanItems.length).toBe(
      loan.instalments.filter((i) => i.dueDay <= addDays(today(), 90)).length,
    );

    expect(item(`salaries:${month()}`)).toMatchObject({
      amountPiastres: 800_000,
      dueDay: monthEnd(today()),
      detail: 'estimate',
    });

    const lastMonth = shiftDayByMonths(`${month()}-01`, -1).slice(0, 7);
    const nextEnd = monthEnd(shiftDayByMonths(`${month()}-01`, 1));
    expect(item(`tax:vat:${lastMonth}`)).toMatchObject({
      amountPiastres: 20_000,
      dueDay: monthEnd(today()),
      detail: 'vat',
    });
    expect(item(`tax:vat:${month()}`)).toMatchObject({ amountPiastres: 20_000, dueDay: nextEnd });

    const payout = due.items.find((i) => i.kind === 'payout')!;
    const schedule = (await prisma.merchant.findUniqueOrThrow({ where: { id: f.merchant.id } }))
      .payoutSchedule;
    expect(payout).toMatchObject({
      label: f.merchant.name,
      amountPiastres: 25_000,
      dueDay: nextPayoutDay(schedule, today()),
      href: '/finance/payouts/run',
    });

    // Rent: this month (not prepared yet) and every 1st in the window.
    const rentItems = due.items.filter((i) => i.kind === 'recurring');
    expect(rentItems[0]).toMatchObject({
      key: `recurring:${rent.id}:${month()}`,
      dueDay: `${month()}-01`,
      amountPiastres: 400_000,
      href: '/finance/recurring',
    });
    expect(rentItems.length).toBeGreaterThanOrEqual(3);

    // Groups: overdue, within 7 days, within 30 days, later; totals add up.
    expect(due.groups.map((g) => g.key)).toEqual(['overdue', 'week', 'month', 'later']);
    for (const g of due.groups) {
      expect(g.items.every((i) => dueGroupOf(i.dueDay, today()) === g.key)).toBe(true);
      expect(g.totalPiastres).toBe(g.items.reduce((s, i) => s + (i.amountPiastres ?? 0), 0));
    }
    expect(due.groups.find((g) => g.key === 'overdue')!.items.map((i) => i.key)).toContain(
      `bill:${lateBill.id}`,
    );
    expect(due.groups.find((g) => g.key === 'week')!.items.map((i) => i.key)).toContain(
      `bill:${storeBill.id}`,
    );
    // Sorted by due day.
    const days = due.items.map((i) => i.dueDay);
    expect([...days].sort()).toEqual(days);

    // The dashboard's 30 days has no "later" group.
    const card = await paymentsDue(prisma, new Date(), { stores: null });
    expect(card.groups.map((g) => g.key)).toEqual(['overdue', 'week', 'month']);
    expect(card.items.every((i) => i.dueDay <= addDays(today(), 30))).toBe(true);

    // Kind filter.
    const onlyBills = await paymentsDue(prisma, new Date(), { stores: null, kinds: ['bill'] });
    expect(new Set(onlyBills.items.map((i) => i.kind))).toEqual(new Set(['bill']));

    // Once this month's rent request exists it waits in Approvals; once approved it is gone.
    await runRecurring(prisma, new Date());
    const request = await prisma.financeRequest.findFirstOrThrow({ where: { kind: 'expense' } });
    const waiting = await paymentsDue(prisma, new Date(), { stores: null, kinds: ['recurring'] });
    expect(waiting.items[0]).toMatchObject({
      key: `recurring:${rent.id}:${month()}`,
      detail: 'waiting_approval',
      href: `/finance/approvals/${request.id}`,
    });
    await decideFinanceRequest(prisma, {
      requestId: request.id,
      approve: true,
      actorUserId: second,
    });
    const after = await paymentsDue(prisma, new Date(), {
      stores: null,
      kinds: ['recurring'],
      days: 40,
    });
    expect(after.items.map((i) => i.key)).not.toContain(`recurring:${rent.id}:${month()}`);
    expect(after.items[0]!.dueDay).toBe(shiftDayByMonths(`${month()}-01`, 1));
  });

  it('shows people limited to some stores their stores and company wide items, no payouts', async () => {
    const { storeBill, lateBill } = await bills();
    await post(prisma, {
      kind: 'test_cod',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'bank' }, amount: 25_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -25_000 },
      ],
    });
    const all = await paymentsDue(prisma, new Date(), { stores: null });
    expect(all.items.map((i) => i.key)).toEqual(
      expect.arrayContaining([`bill:${storeBill.id}`, `bill:${lateBill.id}`]),
    );
    expect(all.items.some((i) => i.kind === 'payout')).toBe(true);

    const mine = await paymentsDue(prisma, new Date(), { stores: [f.store.id] });
    const keys = mine.items.map((i) => i.key);
    expect(keys).toContain(`bill:${lateBill.id}`);
    expect(keys).not.toContain(`bill:${storeBill.id}`);
    expect(mine.items.some((i) => i.kind === 'payout')).toBe(false);

    const theirs = await paymentsDue(prisma, new Date(), { stores: [f.other.id] });
    expect(theirs.items.map((i) => i.key)).toContain(`bill:${storeBill.id}`);
  });
});

describe('payment due reminders', () => {
  async function financePerson(name: string, stores: string[] | null) {
    const user = await prisma.user.create({
      data: { email: `${name}@t.eg`, name, role: 'finance', passwordHash: 'x' },
    });
    await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        user.id,
        {
          ...JOB_ROLE_TEMPLATES.finance_officer,
          ...(stores && { allStores: false }),
          jobRole: 'custom',
        },
        stores ?? [],
      ),
    );
    await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: `https://push.test/${name}`,
        p256dh: 'BKey',
        auth: 'auth',
        lang: 'en',
      },
    });
    return user.id;
  }

  it('pushes N days ahead and on the due day, once each, never for overdue items', async () => {
    await financePerson('all', null);
    await financePerson('mine', [f.store.id]);
    await setSetting(prisma, { key: 'finance.due_reminder_days', value: 3, actorUserId: null });
    const { storeBill, lateBill } = await bills();
    const todayBill = await recordBill(prisma, {
      supplierId: storeBill.supplierId,
      reference: 'R-3',
      billDate: today(),
      dueDate: today(),
      netPiastres: 9_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const push = new FakePush();
    const to = () =>
      push.sent
        .map((s) => `${s.endpoint.replace('https://push.test/', '')}:${s.message.url}`)
        .filter((x) => x.includes('/finance/bills/'))
        .sort();

    // Today: the store bill is due in 3 days (people of that store only, so not "mine"), one
    // bill is due today (everyone), the late one is never pushed.
    const now = new Date();
    await dispatchPush(prisma, push, { now });
    expect(to()).toEqual(
      [
        `all:/finance/bills/${storeBill.id}`,
        `all:/finance/bills/${todayBill.id}`,
        `mine:/finance/bills/${todayBill.id}`,
      ].sort(),
    );
    expect(to().some((x) => x.includes(lateBill.id))).toBe(false);
    const ahead = push.sent.find((s) => s.message.url === `/finance/bills/${storeBill.id}`)!;
    expect(ahead.message.title).toBe(`Due on ${addDays(today(), 3)}: Supplier bill`);
    expect(ahead.message.body).toBe('BILL-000001 (Landlord): 400.00 EGP. Open Coming up and due.');
    const dueNow = push.sent.find((s) => s.message.url === `/finance/bills/${todayBill.id}`)!;
    expect(dueNow.message.title).toBe('Due today: Supplier bill');

    // Running again, in the same scan window or a later one, sends nothing new.
    push.sent = [];
    await dispatchPush(prisma, push, { now });
    await dispatchPush(prisma, push, { now: new Date(now.getTime() + 11 * 60_000) });
    await dispatchPush(prisma, push, { now: new Date(now.getTime() + 60 * 60_000) });
    expect(push.sent).toEqual([]);
    expect(
      await prisma.pushSent.count({
        where: { key: `payment_due:bill:${storeBill.id}:${today()}` },
      }),
    ).toBe(1);

    // The next day: the bill due yesterday is overdue and is not pushed again; the store bill
    // is two days away (no reminder on the days between).
    await dispatchPush(prisma, push, { now: new Date(now.getTime() + 86_400_000) });
    expect(to()).toEqual([]);

    // On its due day the store bill is pushed once more.
    await dispatchPush(prisma, push, { now: new Date(now.getTime() + 3 * 86_400_000) });
    expect(to()).toEqual([`all:/finance/bills/${storeBill.id}`]);
    expect(push.sent[0]!.message.title).toBe('Due today: Supplier bill');
  });

  it('reaches people of a store only for that store and company wide items', async () => {
    await financePerson('all', null);
    await financePerson('mine', [f.store.id]);
    await setSetting(prisma, { key: 'finance.due_reminder_days', value: 0, actorUserId: null });
    const supplier = await createSupplier(prisma, {
      name: 'Cleaner',
      defaultExpenseAccountId: (await byKey('expense:maintenance')).id,
      actorUserId: admin,
    });
    const own = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'C-1',
      billDate: today(),
      dueDate: today(),
      netPiastres: 5_000,
      darkStoreId: f.store.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const other = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'C-2',
      billDate: today(),
      dueDate: today(),
      netPiastres: 6_000,
      darkStoreId: f.other.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const company = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'C-3',
      billDate: today(),
      dueDate: today(),
      netPiastres: 7_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const push = new FakePush();
    await dispatchPush(prisma, push);
    const got = (name: string) =>
      push.sent
        .filter((s) => s.endpoint === `https://push.test/${name}`)
        .map((s) => s.message.url)
        .sort();
    expect(got('all')).toEqual(
      [own.id, other.id, company.id].map((id) => `/finance/bills/${id}`).sort(),
    );
    expect(got('mine')).toEqual([own.id, company.id].map((id) => `/finance/bills/${id}`).sort());
  });
});
