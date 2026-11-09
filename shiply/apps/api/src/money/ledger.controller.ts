import { Controller, Get, HttpException, Inject, Query } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { DB, NeedAccess } from '../platform';
import { LedgerService, type CompanyKey } from './ledger.service';

const company = (c?: string): CompanyKey | undefined => (c === 'shiply' || c === 'shiply_now' ? c : undefined);
const day = (s: string | undefined, fallback: Date) => {
  if (!s) return fallback;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new HttpException({ error: 'invalid_date' }, 400);
  return d;
};

@Controller('money')
export class LedgerController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  @Get('accounts')
  @NeedAccess('accounting', 'view')
  accounts() {
    return this.db.account.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
  }

  @Get('journal')
  @NeedAccess('accounting', 'view')
  async journal(@Query('company') c?: string, @Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    const where = company(c) ? { companyKey: company(c) } : {};
    const [rows, total] = await Promise.all([
      this.db.journalEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * 50, take: 50, include: { lines: true } }),
      this.db.journalEntry.count({ where }),
    ]);
    return { rows, total, page: p, pageSize: 50 };
  }

  @Get('trial-balance')
  @NeedAccess('accounting', 'view')
  trialBalance(@Query('company') c?: string) {
    return this.ledger.trialBalance(company(c));
  }

  @Get('profit-and-loss')
  @NeedAccess('accounting', 'view')
  profitAndLoss(@Query('company') c?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('costCentre') costCentreId?: string) {
    const now = new Date();
    return this.ledger.profitAndLoss({ companyKey: company(c), costCentreId, from: day(from, new Date(now.getFullYear(), now.getMonth(), 1)), to: day(to, now) });
  }
}
