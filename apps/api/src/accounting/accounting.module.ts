import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { CashoutService } from './cashout.service';
import { ExportService } from './export.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { MockPayoutAdapter, PAYOUT } from './payout.adapter';
import { ReportsService } from './reports.service';
import { SettlementService } from './settlement.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [FinanceController, WalletController],
  providers: [
    { provide: PAYOUT, useClass: MockPayoutAdapter },
    CashoutService,
    SettlementService,
    FinanceService,
    ReportsService,
    ExportService,
  ],
  exports: [SettlementService, CashoutService],
})
export class AccountingModule {}
