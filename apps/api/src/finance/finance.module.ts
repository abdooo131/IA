import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { BooksController } from './books.controller';
import { BudgetsController } from './budgets.controller';
import { CashControlController } from './cash-control.controller';
import { ChequesController } from './cheques.controller';
import { ControlsController } from './controls.controller';
import { PayablesController } from './payables.controller';
import { PeriodController } from './period.controller';
import { EtaClient, EtaSync, HttpEtaClient } from './eta';
import { EtaSignerController, InvoicesController } from './invoices.controller';
import { ProfitController } from './profit.controller';
import { PurchasingController } from './purchasing.controller';
import { ToolsController } from './tools.controller';
import { FinanceController } from './finance.controller';
import { RiderOfficesController } from './rider-offices.controller';
import { RiderWithdrawalsController } from './rider-withdrawals.controller';
import { ExpenseClaimsController } from './expense-claims.controller';
import { BasataController } from './basata.controller';
import { FinanceViewsController } from './views.controller';
import { FinanceRunsController } from './runs.controller';
import { LoansTagsFxController } from './loans-tags-fx.controller';
import { AgingController } from './aging.controller';
import { ForecastController } from './forecast.controller';

@Module({
  imports: [CoverageModule],
  controllers: [
    FinanceController,
    BooksController,
    ControlsController,
    ProfitController,
    PayablesController,
    BudgetsController,
    PeriodController,
    InvoicesController,
    EtaSignerController,
    ToolsController,
    CashControlController,
    ChequesController,
    PurchasingController,
    RiderWithdrawalsController,
    RiderOfficesController,
    ExpenseClaimsController,
    BasataController,
    FinanceViewsController,
    FinanceRunsController,
    LoansTagsFxController,
    AgingController,
    ForecastController,
  ],
  providers: [{ provide: EtaClient, useClass: HttpEtaClient }, EtaSync],
})
export class FinanceModule {}
