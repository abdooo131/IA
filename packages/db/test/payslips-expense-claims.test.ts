import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../src/domain-error';
import {
  balanceOf,
  cancelExpenseClaim,
  createAccount,
  decideFinanceRequest,
  ensureDefaultAccounts,
  expenseClaimDetail,
  managerDecideClaim,
  myExpenseClaims,
  myPayslip,
  myPayslips,
  payExpenseClaim,
  recordCapital,
  rejectExpenseClaim,
  setClaimableCategory,
  submitExpenseClaim,
  submitPayroll,
} from '../src/finance';
import { hrInbox } from '../src/hr-inbox';
import { dispatchPush, type PushMessage, type PushSender, type PushTarget } from '../src/push';
import { setSalaryPackage } from '../src/hr-pay';
import { savePhoto } from '../src/photos';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

// Payslips in My HR and employee expense claims (EC-000001).

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let admin2: string;
let n = 0;
const key = () => `ec-${++n}-${Math.random().toString(36).slice(2)}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = cairoDay(new Date());
const lastMonth = addDays(`${today.slice(0, 8)}01`, -1).slice(0, 7);

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

/** A store staff member with an employee file (optionally below a manager). */
async function person(name: string, managerId?: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}@t.eg`,
      name,
      role: 'store_staff',
      darkStoreId: f.store.id,
      passwordHash: 'x',
    },
  });
  const employee = await prisma.employee.create({
    data: { userId: user.id, nameEn: name, homeStoreId: f.store.id, managerId: managerId ?? null },
  });
  return { userId: user.id, employeeId: employee.id };
}

const receipt = (userId: string) =>
  savePhoto(prisma, {
    kind: 'receipt',
    contentType: 'image/jpeg',
    data: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    actorUserId: userId,
  });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  const make = (email: string) =>
    prisma.user.create({ data: { email, name: email, role: 'admin', passwordHash: 'x' } });
  admin = (await make('a@t.eg')).id;
  admin2 = (await make('b@t.eg')).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('payslips in My HR', () => {
  it('shows each person only their own payslips, once the run is posted', async () => {
    const mona = await person('Mona');
    const hany = await person('Hany');
    await setSalaryPackage(prisma, {
      employeeId: mona.employeeId,
      body: {
        effectiveFrom: '2026-01-01',
        basicPiastres: 1_000_000,
        allowances: [{ kind: 'transport', amountPiastres: 100_000 }],
      },
      actorUserId: admin,
    });
    await setSalaryPackage(prisma, {
      employeeId: hany.employeeId,
      body: { effectiveFrom: '2026-01-01', basicPiastres: 800_000, allowances: [] },
      actorUserId: admin,
    });
    // Above the approval limit the run waits for a second person: no payslip yet.
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 1_000,
      actorUserId: admin,
    });
    const sent = await submitPayroll(prisma, {
      month: lastMonth,
      moneyAccountId: (await byKey('bank')).id,
      lines: [{ userId: mona.userId, bonusPiastres: 50_000 }, { userId: hany.userId }],
      actorUserId: admin,
    });
    expect(sent.status).toBe('pending');
    expect(await myPayslips(prisma, mona.userId)).toEqual([]);
    expect(await refusal(myPayslip(prisma, mona.userId, lastMonth))).toBe('payslip_not_found');

    await decideFinanceRequest(prisma, {
      requestId: (sent as { request: { id: string } }).request.id,
      approve: true,
      actorUserId: admin2,
    });
    const slips = await myPayslips(prisma, mona.userId);
    expect(slips).toHaveLength(1);
    const slip = slips[0]!;
    expect(slip).toMatchObject({
      month: lastMonth,
      userId: mona.userId,
      base: 1_100_000,
      basic: 1_000_000,
      allowances: [{ kind: 'transport', amountPiastres: 100_000 }],
      bonus: 50_000,
      gross: 1_150_000,
      paidFrom: { code: (await byKey('bank')).code },
    });
    expect(slip.net).toBe(slip.gross - slip.siEmployee - slip.martyrs - slip.incomeTax);
    // Hany's slip is never in Mona's list, and the other way round.
    expect((await myPayslips(prisma, hany.userId)).map((s) => s.userId)).toEqual([hany.userId]);
    expect((await myPayslip(prisma, hany.userId, lastMonth)).base).toBe(800_000);
    // Someone not on the run has none.
    const other = await person('Other');
    expect(await myPayslips(prisma, other.userId)).toEqual([]);
  });

  it('riders paid per delivery are never on the run, so they have no payslips', async () => {
    const rider = await person('Rider');
    await prisma.employee.update({
      where: { id: rider.employeeId },
      data: { payBasis: 'per_delivery' },
    });
    expect(
      await refusal(
        submitPayroll(prisma, {
          month: lastMonth,
          moneyAccountId: (await byKey('bank')).id,
          lines: [{ userId: rider.userId, grossPiastres: 100_000 }],
          actorUserId: admin,
        }),
      ),
    ).toBe('per_delivery_not_on_payroll');
    expect(await myPayslips(prisma, rider.userId)).toEqual([]);
  });
});

describe('expense claims', () => {
  async function setup() {
    const boss = await person('Boss');
    const staff = await person('Sara', boss.employeeId);
    const fuel = await byKey('expense:fuel');
    await setClaimableCategory(prisma, { accountId: fuel.id, claimable: true, actorUserId: admin });
    return { boss, staff, fuel };
  }
  const claim = async (
    userId: string,
    accountId: string,
    extra: Partial<{ amountPiastres: number; paidOn: string; darkStoreId: string | null }> = {},
  ) =>
    submitExpenseClaim(prisma, {
      userId,
      body: {
        amountPiastres: 25_000,
        expenseAccountId: accountId,
        darkStoreId: f.store.id,
        paidOn: today,
        note: 'Taxi to the hub',
        photoId: (await receipt(userId)).id,
        idempotencyKey: key(),
        ...extra,
      },
    });

  it('goes manager → accounting → paid with one entry tagged with the store and the person', async () => {
    const { boss, staff, fuel } = await setup();
    const c = await claim(staff.userId, fuel.id);
    expect(c).toMatchObject({ number: 'EC-000001', status: 'pending_manager', cancellable: true });
    // The manager sees it in their inbox; accounting cannot pay it yet.
    const inbox = await hrInbox(prisma, { userId: boss.userId, access: null });
    expect(inbox.manager.claims.map((x) => x.id)).toEqual([c.id]);
    expect(inbox.total).toBe(1);
    const bank = await byKey('bank');
    expect(
      await refusal(
        payExpenseClaim(prisma, { claimId: c.id, moneyAccountId: bank.id, actorUserId: admin }),
      ),
    ).toBe('claim_not_waiting');
    // Only the manager in force decides.
    expect(
      await refusal(
        managerDecideClaim(prisma, { claimId: c.id, actorUserId: admin, approve: true }),
      ),
    ).toBe('not_your_team');
    const approved = await managerDecideClaim(prisma, {
      claimId: c.id,
      actorUserId: boss.userId,
      approve: true,
    });
    expect(approved).toMatchObject({ status: 'pending_accounting', cancellable: false });
    expect(
      await refusal(cancelExpenseClaim(prisma, { claimId: c.id, actorUserId: staff.userId })),
    ).toBe('claim_not_cancellable');

    const before = await balanceOf(prisma, { id: bank.id });
    const paid = await payExpenseClaim(prisma, {
      claimId: c.id,
      moneyAccountId: bank.id,
      reference: 'TRX-1',
      actorUserId: admin,
    });
    expect(paid.status).toBe('paid');
    expect(await balanceOf(prisma, { id: bank.id })).toBe(before - 25_000);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { idempotencyKey: `expense_claim:${c.id}` },
      include: { lines: true, receipts: true },
    });
    expect(entry.kind).toBe('expense_claim');
    const debit = entry.lines.find((l) => l.accountId === fuel.id)!;
    expect(debit).toMatchObject({
      amountPiastres: 25_000,
      darkStoreId: f.store.id,
      userId: staff.userId,
    });
    expect(entry.lines.find((l) => l.accountId === bank.id)!.amountPiastres).toBe(-25_000);
    expect(entry.receipts.map((r) => r.photoId)).toEqual([c.photoId]);
    // Paying again changes nothing.
    await payExpenseClaim(prisma, { claimId: c.id, moneyAccountId: bank.id, actorUserId: admin });
    expect(await balanceOf(prisma, { id: bank.id })).toBe(before - 25_000);
    expect((await myExpenseClaims(prisma, staff.userId)).claims[0]!.status).toBe('paid');
  });

  it('a person without a manager goes straight to accounting and may cancel until paid', async () => {
    const { fuel } = await setup();
    const loner = await person('Loner');
    const c = await claim(loner.userId, fuel.id, { darkStoreId: null });
    expect(c).toMatchObject({ status: 'pending_accounting', cancellable: true });
    const cancelled = await cancelExpenseClaim(prisma, {
      claimId: c.id,
      actorUserId: loner.userId,
    });
    expect(cancelled.status).toBe('cancelled');
    // Another person cannot cancel it.
    const c2 = await claim(loner.userId, fuel.id);
    expect(await refusal(cancelExpenseClaim(prisma, { claimId: c2.id, actorUserId: admin }))).toBe(
      'expense_claim_not_found',
    );
  });

  it('is rejected with a reason by the manager or by accounting', async () => {
    const { boss, staff, fuel } = await setup();
    const c = await claim(staff.userId, fuel.id);
    expect(
      await refusal(
        managerDecideClaim(prisma, { claimId: c.id, actorUserId: boss.userId, approve: false }),
      ),
    ).toBe('reason_required');
    const no = await managerDecideClaim(prisma, {
      claimId: c.id,
      actorUserId: boss.userId,
      approve: false,
      reason: 'Not a work trip',
    });
    expect(no).toMatchObject({
      status: 'rejected',
      rejectReason: 'Not a work trip',
      rejectedStep: 'manager',
    });
    const c2 = await claim(staff.userId, fuel.id);
    await managerDecideClaim(prisma, { claimId: c2.id, actorUserId: boss.userId, approve: true });
    const no2 = await rejectExpenseClaim(prisma, {
      claimId: c2.id,
      actorUserId: admin,
      reason: 'Receipt unreadable',
    });
    expect(no2).toMatchObject({ status: 'rejected', rejectedStep: 'accounting' });
    expect(await prisma.ledgerEntry.count({ where: { kind: 'expense_claim' } })).toBe(0);
  });

  it('nobody decides or pays their own claim; the approver does not pay from the limit', async () => {
    const { boss, staff, fuel } = await setup();
    // The boss (no manager of their own) cannot approve or pay their own claim.
    const own = await claim(boss.userId, fuel.id);
    expect(own.status).toBe('pending_accounting');
    const bank = await byKey('bank');
    expect(
      await refusal(
        payExpenseClaim(prisma, {
          claimId: own.id,
          moneyAccountId: bank.id,
          actorUserId: boss.userId,
        }),
      ),
    ).toBe('own_claim');
    expect(
      await refusal(
        rejectExpenseClaim(prisma, { claimId: own.id, actorUserId: boss.userId, reason: 'x x x' }),
      ),
    ).toBe('own_claim');
    // From the approval limit the manager who approved may not pay too.
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 20_000,
      actorUserId: admin,
    });
    const c = await claim(staff.userId, fuel.id);
    await managerDecideClaim(prisma, { claimId: c.id, actorUserId: boss.userId, approve: true });
    expect(
      await refusal(
        payExpenseClaim(prisma, {
          claimId: c.id,
          moneyAccountId: bank.id,
          actorUserId: boss.userId,
        }),
      ),
    ).toBe('same_person');
    expect(
      (
        await payExpenseClaim(prisma, {
          claimId: c.id,
          moneyAccountId: bank.id,
          actorUserId: admin,
        })
      ).status,
    ).toBe('paid');
    // Below the limit the approver may pay.
    const small = await claim(staff.userId, fuel.id, { amountPiastres: 5_000 });
    await managerDecideClaim(prisma, {
      claimId: small.id,
      actorUserId: boss.userId,
      approve: true,
    });
    expect(
      (
        await payExpenseClaim(prisma, {
          claimId: small.id,
          moneyAccountId: bank.id,
          actorUserId: boss.userId,
        })
      ).status,
    ).toBe('paid');
  });

  it('never pays more than the bank or cash box holds', async () => {
    const { boss, staff, fuel } = await setup();
    const box = await createAccount(prisma, {
      groupCode: 1200,
      nameEn: 'Office safe',
      nameAr: 'خزنة المكتب',
      actorUserId: admin,
    });
    expect(await balanceOf(prisma, { id: box.id })).toBe(0);
    const c = await claim(staff.userId, fuel.id);
    await managerDecideClaim(prisma, { claimId: c.id, actorUserId: boss.userId, approve: true });
    expect(
      await refusal(
        payExpenseClaim(prisma, { claimId: c.id, moneyAccountId: box.id, actorUserId: admin }),
      ),
    ).toBe('not_enough_money');
    // An expense category is not a bank or box.
    expect(
      await refusal(
        payExpenseClaim(prisma, { claimId: c.id, moneyAccountId: fuel.id, actorUserId: admin }),
      ),
    ).toBe('account_not_found');
  });

  it('refuses a future day, a day older than claims.max_age_days, and other categories', async () => {
    const { staff, fuel } = await setup();
    expect(await refusal(claim(staff.userId, fuel.id, { paidOn: addDays(today, 1) }))).toBe(
      'day_in_future',
    );
    expect(await refusal(claim(staff.userId, fuel.id, { paidOn: addDays(today, -61) }))).toBe(
      'claim_too_old',
    );
    expect((await claim(staff.userId, fuel.id, { paidOn: addDays(today, -60) })).status).toBe(
      'pending_manager',
    );
    await setSetting(prisma, { key: 'claims.max_age_days', value: 10, actorUserId: admin });
    expect(await refusal(claim(staff.userId, fuel.id, { paidOn: addDays(today, -11) }))).toBe(
      'claim_too_old',
    );
    const rent = await byKey('expense:rent');
    expect(await refusal(claim(staff.userId, rent.id))).toBe('claim_category_not_found');
    // A receipt someone else uploaded is refused.
    expect(
      await refusal(
        submitExpenseClaim(prisma, {
          userId: staff.userId,
          body: {
            amountPiastres: 100,
            expenseAccountId: fuel.id,
            darkStoreId: null,
            paidOn: today,
            note: 'Taxi',
            photoId: (await receipt(admin)).id,
            idempotencyKey: key(),
          },
        }),
      ),
    ).toBe('receipt_required');
  });

  it('a person reads only their own claim; their manager reads their team’s', async () => {
    const { boss, staff, fuel } = await setup();
    const other = await person('Other');
    const c = await claim(staff.userId, fuel.id);
    expect(
      (
        await expenseClaimDetail(prisma, {
          claimId: c.id,
          viewerUserId: staff.userId,
          scope: 'self',
        })
      ).id,
    ).toBe(c.id);
    expect(
      await refusal(
        expenseClaimDetail(prisma, { claimId: c.id, viewerUserId: other.userId, scope: 'self' }),
      ),
    ).toBe('expense_claim_not_found');
    expect(
      await refusal(
        expenseClaimDetail(prisma, { claimId: c.id, viewerUserId: other.userId, scope: 'manager' }),
      ),
    ).toBe('expense_claim_not_found');
    expect(
      (
        await expenseClaimDetail(prisma, {
          claimId: c.id,
          viewerUserId: boss.userId,
          scope: 'manager',
        })
      ).id,
    ).toBe(c.id);
    expect((await myExpenseClaims(prisma, other.userId)).claims).toEqual([]);
  });
});

describe('notifications', () => {
  class FakePush implements PushSender {
    enabled = true;
    sent: { to: string; message: PushMessage }[] = [];
    async send(target: PushTarget, message: PushMessage) {
      this.sent.push({ to: target.endpoint.replace('https://push.test/', ''), message });
      return 'sent' as const;
    }
  }
  const device = (userId: string, name: string) =>
    prisma.pushSubscription.create({
      data: { userId, endpoint: `https://push.test/${name}`, p256dh: 'k', auth: 'a', lang: 'en' },
    });

  it('tells the manager about a new claim, the person about decisions and a new payslip', async () => {
    const boss = await person('Boss');
    const staff = await person('Sara', boss.employeeId);
    await device(boss.userId, 'boss');
    await device(staff.userId, 'sara');
    const push = new FakePush();
    const fuel = await byKey('expense:fuel');
    await setClaimableCategory(prisma, { accountId: fuel.id, claimable: true, actorUserId: admin });
    const c = await submitExpenseClaim(prisma, {
      userId: staff.userId,
      body: {
        amountPiastres: 12_345,
        expenseAccountId: fuel.id,
        darkStoreId: null,
        paidOn: today,
        note: 'Parking',
        photoId: (await receipt(staff.userId)).id,
        idempotencyKey: key(),
      },
    });
    await dispatchPush(prisma, push);
    expect(push.sent.map((s) => s.to)).toEqual(['boss']);
    expect(push.sent[0]!.message.title).toBe('Expense claim from Sara');
    await managerDecideClaim(prisma, { claimId: c.id, actorUserId: boss.userId, approve: true });
    await dispatchPush(prisma, push);
    expect(push.sent.map((s) => s.to)).toEqual(['boss', 'sara']);
    expect(push.sent[1]!.message.title).toBe(`Expense claim ${c.number} approved`);
    // Running again sends nothing twice.
    await dispatchPush(prisma, push);
    expect(push.sent).toHaveLength(2);

    await setSalaryPackage(prisma, {
      employeeId: staff.employeeId,
      body: { effectiveFrom: '2026-01-01', basicPiastres: 500_000, allowances: [] },
      actorUserId: admin,
    });
    await submitPayroll(prisma, {
      month: lastMonth,
      moneyAccountId: (await byKey('bank')).id,
      lines: [{ userId: staff.userId }],
      actorUserId: admin,
    });
    await dispatchPush(prisma, push);
    expect(push.sent.map((s) => s.to)).toEqual(['boss', 'sara', 'sara']);
    expect(push.sent[2]!.message).toMatchObject({
      title: `Your payslip for ${lastMonth} is ready`,
      url: `/my-file/payslips/${lastMonth}`,
    });
  });
});
