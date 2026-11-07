import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Roles, assertHubAccess, assertMerchantRight, type SessionUser } from '../auth/auth';
import { DomainError } from '../common/errors';
import { BooksService } from './books.service';
import { FinanceService } from './finance.service';

function sendFile(res: Response, f: { data: Uint8Array; mime: string; name: string }) {
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(f.data));
}

const yes = (v: string) => v === 'approve';
function decision(v: string) {
  if (v !== 'approve' && v !== 'reject') throw new DomainError('invalid_input', 'Use approve or reject', 422);
  return yes(v);
}

/** Finance: everything that moves money, plus the books and reports. */
@Controller('finance')
@Roles('ADMIN')
export class FinanceController {
  constructor(
    private readonly f: FinanceService,
    private readonly b: BooksService,
  ) {}

  // tax invoices and credit notes
  @Post('invoices/issue')
  @HttpCode(200)
  issue(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.issueInvoices(body, u);
  }

  @Get('invoices')
  invoices(@Query('month') month?: string, @Query('merchantId') merchantId?: string) {
    return this.b.invoices({ month: month || undefined, merchantId: merchantId || undefined });
  }

  @Get('invoices/:id')
  taxInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.b.invoice(id);
  }

  @Get('invoices/:id/eta')
  async eta(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const doc = await this.b.etaDocument(id, u);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="eta-${id.slice(0, 8)}.json"`);
    res.send(JSON.stringify(doc, null, 2));
  }

  @Post('credit-notes')
  creditNote(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.createCreditNote(body, u);
  }

  @Post('credit-notes/:id/:decision')
  @HttpCode(200)
  creditNoteDecision(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string) {
    return this.b.decideCreditNote(id, decision(d), u);
  }

  @Get('reports/vat')
  vat(@Query('month') month?: string) {
    return this.b.vatReport(month || undefined);
  }

  @Post('tax/vat-payment')
  @HttpCode(200)
  payVat(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.payVat(body, u);
  }

  @Post('tax/wht-payment')
  @HttpCode(200)
  payWht(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.payWithholding(body, u);
  }

  // suppliers and bills
  @Get('suppliers')
  suppliers() {
    return this.b.suppliers();
  }

  @Post('suppliers')
  addSupplier(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.saveSupplier(null, body, u);
  }

  @Put('suppliers/:id')
  updateSupplier(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.b.saveSupplier(id, body, u);
  }

  @Get('bills')
  bills(@Query('status') status?: string) {
    return this.b.bills(status || undefined);
  }

  @Post('bills')
  addBill(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.createBill(body, u);
  }

  @Get('bills/:id/file')
  async billFile(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.b.billFile(id));
  }

  @Post('bills/:id/:decision')
  @HttpCode(200)
  bill(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string, @Body() body: unknown) {
    if (d === 'paid') return this.b.payBill(id, body, u);
    return this.b.decideBill(id, decision(d), u);
  }

  // bank statement
  @Get('bank')
  reconciliation() {
    return this.b.reconciliation();
  }

  @Post('bank/import')
  importBank(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.importStatement(body, u);
  }

  @Post('bank/auto-match')
  @HttpCode(200)
  async autoMatch() {
    return { matched: await this.b.autoMatch() };
  }

  @Post('bank/:id/match')
  @HttpCode(200)
  match(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.b.matchLine(id, body, u);
  }

  @Post('bank/:id/unmatch')
  @HttpCode(200)
  unmatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.b.unmatchLine(id);
  }

  @Post('bank/:id/book')
  @HttpCode(200)
  book(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.b.bookLine(id, body, u);
  }

  // more reports
  @Get('reports/cash-flow')
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.b.cashFlow(from || undefined, to || undefined);
  }

  @Get('reports/profit')
  profit(@Query('from') from?: string, @Query('to') to?: string) {
    return this.b.profit(from || undefined, to || undefined);
  }

  @Get('budgets')
  budgets(@Query('month') month?: string) {
    return this.b.budgets(month || undefined);
  }

  @Put('budgets')
  @HttpCode(200)
  saveBudgets(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.saveBudgets(body, u);
  }

  @Post('jobs/cash-limits')
  @HttpCode(200)
  cashLimits() {
    return this.b.cashLimitCheck();
  }

  // agent advances
  @Get('advances')
  advances(@Query('agentId') agentId?: string) {
    return this.b.advances(agentId || undefined);
  }

  @Post('advances/:id/:decision')
  @HttpCode(200)
  advance(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string) {
    if (d === 'paid') return this.b.payAdvance(id, u);
    return this.b.decideAdvance(id, decision(d), u);
  }

  @Get('inbox')
  inbox(@CurrentUser() u: SessionUser) {
    return this.f.inbox(u);
  }

  // merchants
  @Get('merchants')
  merchants() {
    return this.f.merchantBalances();
  }

  @Put('merchants/:id/bank')
  @HttpCode(200)
  bank(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.setMerchantBank(id, body, u);
  }

  @Post('merchants/:id/bank/:decision')
  @HttpCode(200)
  bankDecision(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string) {
    return this.f.decideMerchantBank(id, decision(d), u);
  }

  @Put('merchants/:id/payout-days')
  @HttpCode(200)
  payoutDays(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.setPayoutDays(id, body, u);
  }

  @Post('merchants/:id/payouts')
  createPayout(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.createPayout(id, body, u);
  }

  @Post('payouts/due')
  @HttpCode(200)
  due(@CurrentUser() u: SessionUser) {
    return this.f.createDuePayouts(u);
  }

  @Get('payouts')
  payouts(@Query('status') status?: string) {
    return this.f.payouts(status || undefined);
  }

  @Post('payouts/:id/approve')
  @HttpCode(200)
  approvePayout(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.f.approvePayout(id, u);
  }

  @Post('payouts/:id/cancel')
  @HttpCode(200)
  cancelPayout(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.f.cancelPayout(id, u);
  }

  @Post('payouts/:id/paid')
  @HttpCode(200)
  paid(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.payPayout(id, body, u);
  }

  @Get('bank-file')
  async bankFile(@Res() res: Response) {
    const { csv } = await this.f.bankFile();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bank-transfers.csv"`);
    res.send('﻿' + csv);
  }

  // couriers
  @Get('couriers')
  couriers() {
    return this.f.couriers();
  }

  @Get('couriers/:id')
  courier(@Param('id', ParseUUIDPipe) id: string) {
    return this.f.courierWallet(id);
  }

  @Post('couriers/:id/adjust')
  adjust(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.adjustCourier(id, body, u);
  }

  @Post('couriers/:id/unfreeze')
  @HttpCode(200)
  unfreeze(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.unfreeze(id, body, u);
  }

  @Get('withdrawals')
  withdrawals(@Query('status') status?: string) {
    return this.f.withdrawals(status || undefined);
  }

  @Post('withdrawals/:id/:decision')
  @HttpCode(200)
  withdrawal(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string, @Body() body: unknown) {
    if (d === 'paid') return this.f.payWithdrawal(id, u);
    return this.f.decideWithdrawal(id, decision(d), body, u);
  }

  @Get('pay-ins')
  payIns(@Query('status') status?: string) {
    return this.f.payIns(status || undefined);
  }

  @Get('pay-ins/:id/receipt')
  async payInReceipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.payInReceipt(id));
  }

  @Post('pay-ins/:id/:decision')
  @HttpCode(200)
  payIn(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string, @Body() body: unknown) {
    return this.f.decidePayIn(id, decision(d), body, u);
  }

  // hub safes
  @Get('deposits')
  deposits(@Query('status') status?: string) {
    return this.f.deposits(status || undefined);
  }

  @Get('deposits/:id/receipt')
  async depositReceipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.depositReceipt(id));
  }

  @Post('deposits/:id/:decision')
  @HttpCode(200)
  deposit(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string, @Body() body: unknown) {
    return this.f.decideDeposit(id, decision(d), body, u);
  }

  // agents
  @Get('settlements/preview')
  preview(@Query() q: unknown) {
    return this.f.previewSettlement(q);
  }

  @Get('settlements')
  settlements(@Query('agentId') agentId?: string) {
    return this.f.settlements(agentId || undefined);
  }

  @Post('settlements')
  createSettlement(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.f.createSettlement(body, u);
  }

  @Post('settlements/:id/invoice')
  @HttpCode(200)
  uploadInvoice(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.uploadInvoice(id, body, u);
  }

  @Get('settlements/:id/invoice')
  async invoice(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.invoice(id));
  }

  @Post('settlements/:id/:decision')
  @HttpCode(200)
  settlement(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string, @Body() body: unknown) {
    if (d === 'paid') return this.f.paySettlement(id, body, u);
    return this.f.approveSettlement(id, decision(d), u);
  }

  // expenses, accounts, journals
  @Get('accounts')
  accounts() {
    return this.f.accounts();
  }

  @Post('accounts')
  addAccount(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.f.addAccount(body, u);
  }

  @Get('expenses')
  expenses() {
    return this.f.expenses();
  }

  @Post('expenses')
  createExpense(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.f.createExpense(body, u);
  }

  @Get('expenses/:id/receipt')
  async expenseReceipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.expenseReceipt(id));
  }

  @Post('expenses/:id/:decision')
  @HttpCode(200)
  expense(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string) {
    return this.f.decideExpense(id, decision(d), u);
  }

  @Get('journals/drafts')
  drafts() {
    return this.f.journalDrafts();
  }

  @Post('journals')
  createJournal(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.f.createJournal(body, u);
  }

  @Post('journals/:id/:decision')
  @HttpCode(200)
  journal(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('decision') d: string) {
    return this.f.decideJournal(id, decision(d), u);
  }

  @Get('journal')
  entries(@Query() q: { from?: string; to?: string; account?: string; source?: string }) {
    return this.f.journal(q);
  }

  @Post('close')
  @HttpCode(200)
  close(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.f.closeBooks(body, u);
  }

  // reports
  @Get('reports/trial-balance')
  trialBalance(@Query('through') through?: string) {
    return this.f.trialBalance(through || undefined);
  }

  @Get('reports/profit-and-loss')
  pnl(@Query('from') from?: string, @Query('to') to?: string) {
    return this.f.profitAndLoss(from || undefined, to || undefined);
  }

  @Get('reports/balance-sheet')
  balanceSheet(@Query('through') through?: string) {
    return this.f.balanceSheet(through || undefined);
  }

  @Get('reports/cod-aging')
  aging() {
    return this.f.codAging();
  }

  @Get('wallets/:kind')
  wallets(@Param('kind') kind: string) {
    if (!['MERCHANT', 'COURIER', 'AGENT', 'HUB', 'SUPPLIER'].includes(kind)) throw new DomainError('invalid_input', 'Unknown wallet kind', 422);
    return this.f.wallets(kind as 'MERCHANT');
  }
}

/** A courier's own wallet, withdrawals and Fawry pay ins. */
@Controller('courier')
@Roles('COURIER')
export class CourierMoneyController {
  constructor(private readonly f: FinanceService) {}

  @Get('wallet')
  wallet(@CurrentUser() u: SessionUser) {
    return this.f.courierWallet(u.id);
  }

  @Post('withdrawals')
  withdraw(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.f.requestWithdrawal(u, body);
  }

  @Post('pay-ins')
  payIn(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.f.submitPayIn(u, body);
  }

  @Get('pay-ins/:id/receipt')
  async receipt(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.payInReceipt(id, u.id));
  }
}

/** The hub safe: balance, and taking cash to the bank. */
@Controller('hubs/:hubId/safe')
@Roles('ADMIN', 'HUB_STAFF')
export class HubSafeController {
  constructor(private readonly f: FinanceService) {}

  @Get()
  safe(@CurrentUser() u: SessionUser, @Param('hubId', ParseUUIDPipe) hubId: string) {
    assertHubAccess(u, hubId);
    return this.f.safe(hubId);
  }

  @Post('deposits')
  deposit(@CurrentUser() u: SessionUser, @Param('hubId', ParseUUIDPipe) hubId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.f.createDeposit(hubId, body, u);
  }
}

/** The agent sees their month end settlements, uploads their invoice, and asks for advances. */
@Controller('agent')
@Roles('AGENT')
export class AgentMoneyController {
  constructor(
    private readonly f: FinanceService,
    private readonly b: BooksService,
  ) {}

  @Get('advances')
  async advances(@CurrentUser() u: SessionUser) {
    const agentId = this.agent(u);
    return { room: await this.b.advanceRoom(agentId), list: await this.b.advances(agentId) };
  }

  @Post('advances')
  requestAdvance(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.b.requestAdvance(this.agent(u), body, u);
  }

  private agent(u: SessionUser) {
    if (!u.agentId) throw new DomainError('forbidden', 'Your account is not linked to an agent', 403);
    return u.agentId;
  }

  @Get('settlements')
  list(@CurrentUser() u: SessionUser) {
    return this.f.settlements(this.agent(u));
  }

  @Post('settlements/:id/invoice')
  @HttpCode(200)
  upload(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.f.uploadInvoice(id, body, u, this.agent(u));
  }

  @Get('settlements/:id/invoice')
  async invoice(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.invoice(id, this.agent(u)));
  }
}

/** A merchant asks to change where they are paid (finance approves), and reads their tax invoices. */
@Controller('merchant')
@Roles('MERCHANT')
export class MerchantBankController {
  constructor(
    private readonly f: FinanceService,
    private readonly b: BooksService,
  ) {}

  @Get('invoices')
  invoices(@CurrentUser() u: SessionUser) {
    if (!u.merchantId) throw new DomainError('forbidden', 'This account is not linked to a merchant', 403);
    assertMerchantRight(u, 'money');
    return this.b.invoices({ merchantId: u.merchantId });
  }

  @Get('invoices/:id')
  invoice(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!u.merchantId) throw new DomainError('forbidden', 'This account is not linked to a merchant', 403);
    assertMerchantRight(u, 'money');
    return this.b.invoice(id, u.merchantId);
  }

  @Put('bank')
  @HttpCode(200)
  set(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    if (!u.merchantId) throw new DomainError('forbidden', 'This account is not linked to a merchant', 403);
    assertMerchantRight(u, 'money');
    return this.f.setMerchantBank(u.merchantId, body, u);
  }
}
