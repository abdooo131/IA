import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { atLeast } from '@shiply/shared';
import { DB, HomeRegistry, onEvent } from '../platform';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { LedgerService, type CompanyKey } from './ledger.service';

@Injectable()
class MoneyWiring implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
    @Inject(CashService) private readonly cash: CashService,
  ) {}
  onModuleInit() {
    onEvent('cash.collected', 'money.cash', async (payload, tx) => {
      await this.cash.collected(tx, payload as { companyKey: CompanyKey; holderId: string; merchantId: string; amount: number; sourceType: string; sourceId: string });
    });
    const short = () => this.db.handover.count({ where: { status: 'disputed' } });
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.accounting, 'use')) return [];
      const count = await short();
      return count ? [{ app: 'accounting', text: 'home.handoverShort', values: { count }, href: '/accounting/handovers?status=disputed', urgency: 1 }] : [];
    });
  }
}

@Module({
  controllers: [CashController],
  providers: [LedgerService, CashService, MoneyWiring],
  exports: [LedgerService, CashService],
})
export class MoneyModule {}
