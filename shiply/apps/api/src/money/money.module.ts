import { Inject, Injectable, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { atLeast } from '@shiply/shared';
import { DB, HomeRegistry, onEvent } from '../platform';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { LedgerService, type CompanyKey } from './ledger.service';
import { LedgerController } from './ledger.controller';
import { MoneyService } from './money.service';
import { PayoutsController } from './payouts.controller';
import { SpendingController } from './spending.controller';
import { WalletsController } from './wallets.controller';
import { WalletsService, type FeeKind } from './wallets.service';

@Injectable()
class MoneyWiring implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
    @Inject(CashService) private readonly cash: CashService,
    @Inject(WalletsService) private readonly wallets: WalletsService,
  ) {}
  onModuleInit() {
    onEvent('cash.collected', 'money.cash', async (payload, tx) => {
      await this.cash.collected(tx, payload as { companyKey: CompanyKey; holderId: string; merchantId: string; amount: number; sourceType: string; sourceId: string });
    });
    onEvent('fee.charged', 'money.fees', async (payload, tx) => {
      await this.wallets.feeCharged(tx, payload as { companyKey: CompanyKey; merchantId: string; kind: FeeKind; amount: number; costCentreId?: string; sourceType: string; sourceId: string });
    });
    const waiting = async () => (await this.db.payout.count({ where: { status: 'draft' } })) + (await this.db.bill.count({ where: { status: 'draft' } }));
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.accounting, 'manage')) return [];
      const count = await waiting();
      return count ? [{ app: 'accounting', text: 'home.approvalsWaiting', values: { count }, href: '/accounting/payouts', urgency: 2 }] : [];
    });
    this.home.addCount('accounting', async (user) => (atLeast(user.access.accounting, 'manage') ? waiting() : 0));
    const short = () => this.db.handover.count({ where: { status: 'disputed' } });
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.accounting, 'use')) return [];
      const count = await short();
      return count ? [{ app: 'accounting', text: 'home.handoverShort', values: { count }, href: '/accounting/handovers?status=disputed', urgency: 1 }] : [];
    });
  }
}

@Module({})
export class MoneyModule {
  static register(merchants: DynamicModule): DynamicModule {
    return {
      module: MoneyModule,
      imports: [merchants],
      controllers: [CashController, WalletsController, PayoutsController, SpendingController, LedgerController],
      providers: [LedgerService, CashService, WalletsService, MoneyService, MoneyWiring],
      exports: [LedgerService, CashService, WalletsService, MoneyService],
    };
  }
}
