import { ParseIdPipe } from '../common/id.pipe';
import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, ParcelsApp, Roles, assertHubAccess, type SessionUser } from '../auth/auth';
import { DomainError } from '../common/errors';
import { BooksService } from './books.service';
import { FinanceService } from './finance.service';
import { PrismaService } from '../common/prisma.service';
import { balanceSheet, trialBalance } from '@shiplynow/db';
import { cairoDay } from '@shiplynow/shared';

function sendFile(res: Response, f: { data: Uint8Array; mime: string; name: string }) {
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(f.data));
}

const yes = (v: string) => v === 'approve';
function decision(v: string) {
  if (v !== 'approve' && v !== 'reject')
    throw new DomainError('invalid_input', 'Use approve or reject', 422);
  return yes(v);
}

/** Finance: everything that moves money, plus the books and reports. */
@Controller('finance')
@Roles('ADMIN')
@ParcelsApp('accounting')
export class FinanceController {
  constructor(
    private readonly f: FinanceService,
    private readonly b: BooksService,
    private readonly prisma: PrismaService,
  ) {}

  /** The combined books of both companies (one ledger); full reports live in Accounting. */
  @Get('reports/trial-balance')
  async trialBalance() {
    const tb = await trialBalance(this.prisma);
    return { ...tb, balanced: tb.totalDebitPiastres === tb.totalCreditPiastres };
  }

  @Get('reports/balance-sheet')
  async balanceSheet() {
    const bs = await balanceSheet(this.prisma, cairoDay(new Date()));
    return {
      ...bs,
      balanced: bs.totalAssetsPiastres === bs.totalLiabilitiesPiastres + bs.totalEquityPiastres,
    };
  }

  // suppliers and bills
  // bank statement
  // more reports
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
  advance(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('decision') d: string,
  ) {
    if (d === 'paid') return this.b.payAdvance(id, u);
    return this.b.decideAdvance(id, decision(d), u);
  }

  @Get('inbox')
  inbox(@CurrentUser() u: SessionUser) {
    return this.f.inbox(u);
  }

  // merchants
  // couriers
  @Get('couriers')
  couriers() {
    return this.f.couriers();
  }

  @Get('couriers/:id')
  courier(@Param('id', ParseIdPipe) id: string) {
    return this.f.courierWallet(id);
  }

  @Post('couriers/:id/adjust')
  adjust(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.f.adjustCourier(id, body, u);
  }

  @Post('couriers/:id/unfreeze')
  @HttpCode(200)
  unfreeze(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.f.unfreeze(id, body, u);
  }

  @Get('withdrawals')
  withdrawals(@Query('status') status?: string) {
    return this.f.withdrawals(status || undefined);
  }

  @Post('withdrawals/:id/:decision')
  @HttpCode(200)
  withdrawal(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('decision') d: string,
    @Body() body: unknown,
  ) {
    if (d === 'paid') return this.f.payWithdrawal(id, u);
    return this.f.decideWithdrawal(id, decision(d), body, u);
  }

  @Get('pay-ins')
  payIns(@Query('status') status?: string) {
    return this.f.payIns(status || undefined);
  }

  @Get('pay-ins/:id/receipt')
  async payInReceipt(@Param('id', ParseIdPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.payInReceipt(id));
  }

  @Post('pay-ins/:id/:decision')
  @HttpCode(200)
  payIn(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('decision') d: string,
    @Body() body: unknown,
  ) {
    return this.f.decidePayIn(id, decision(d), body, u);
  }

  // hub safes
  @Get('deposits')
  deposits(@Query('status') status?: string) {
    return this.f.deposits(status || undefined);
  }

  @Get('deposits/:id/receipt')
  async depositReceipt(@Param('id', ParseIdPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.depositReceipt(id));
  }

  @Post('deposits/:id/:decision')
  @HttpCode(200)
  deposit(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('decision') d: string,
    @Body() body: unknown,
  ) {
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
  uploadInvoice(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.f.uploadInvoice(id, body, u);
  }

  @Get('settlements/:id/invoice')
  async invoice(@Param('id', ParseIdPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.f.invoice(id));
  }

  @Post('settlements/:id/:decision')
  @HttpCode(200)
  settlement(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('decision') d: string,
    @Body() body: unknown,
  ) {
    if (d === 'paid') return this.f.paySettlement(id, body, u);
    return this.f.approveSettlement(id, decision(d), u);
  }

  // expenses, accounts, journals
  // reports
  @Get('wallets/:kind')
  wallets(@Param('kind') kind: string) {
    if (!['MERCHANT', 'COURIER', 'AGENT', 'HUB', 'SUPPLIER'].includes(kind))
      throw new DomainError('invalid_input', 'Unknown wallet kind', 422);
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
  async receipt(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.f.payInReceipt(id, u.id));
  }
}

/** The hub safe: balance, and taking cash to the bank. */
@Controller('hubs/:hubId/safe')
@Roles('ADMIN', 'HUB_STAFF')
export class HubSafeController {
  constructor(private readonly f: FinanceService) {}

  @Get()
  safe(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    assertHubAccess(u, hubId);
    return this.f.safe(hubId);
  }

  @Post('deposits')
  deposit(
    @CurrentUser() u: SessionUser,
    @Param('hubId', ParseIdPipe) hubId: string,
    @Body() body: unknown,
  ) {
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
    if (!u.agentId)
      throw new DomainError('forbidden', 'Your account is not linked to an agent', 403);
    return u.agentId;
  }

  @Get('settlements')
  list(@CurrentUser() u: SessionUser) {
    return this.f.settlements(this.agent(u));
  }

  @Post('settlements/:id/invoice')
  @HttpCode(200)
  upload(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.f.uploadInvoice(id, body, u, this.agent(u));
  }

  @Get('settlements/:id/invoice')
  async invoice(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await this.f.invoice(id, this.agent(u)));
  }
}

/** A merchant asks to change where they are paid (finance approves), and reads their tax invoices. */
