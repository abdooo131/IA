import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NeedAccess } from '../platform';
import { WalletsService } from './wallets.service';

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // Text that a spreadsheet would run as a formula is neutralised.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

@Controller('money/wallets')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly wallets: WalletsService) {}

  @Get()
  @NeedAccess('accounting', 'view')
  list(@Query('q') q?: string) {
    return this.wallets.list(q);
  }

  @Get(':merchantId/statement')
  @NeedAccess('accounting', 'view')
  statement(@Param('merchantId') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.wallets.statement(id, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Get(':merchantId/statement.csv')
  @NeedAccess('accounting', 'view')
  async csv(@Param('merchantId') id: string, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const s = await this.wallets.statement(id, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
    const rows = [['date', 'description', 'amount_egp', 'balance_egp'], ...s.lines.map((l) => [l.date.toISOString().slice(0, 10), l.memo, (l.amount / 100).toFixed(2), (l.running / 100).toFixed(2)])];
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="statement-${id}.csv"`);
    res.send('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
  }
}
