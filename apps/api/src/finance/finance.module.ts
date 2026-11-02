import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { BooksController } from './books.controller';
import { ControlsController } from './controls.controller';
import { PayablesController } from './payables.controller';
import { PeriodController } from './period.controller';
import { EtaClient, EtaSync, HttpEtaClient } from './eta';
import { EtaSignerController, InvoicesController } from './invoices.controller';
import { ProfitController } from './profit.controller';
import { ToolsController } from './tools.controller';
import { FinanceController } from './finance.controller';

@Module({
  imports: [CoverageModule],
  controllers: [
    FinanceController,
    BooksController,
    ControlsController,
    ProfitController,
    PayablesController,
    PeriodController,
    InvoicesController,
    EtaSignerController,
    ToolsController,
  ],
  providers: [{ provide: EtaClient, useClass: HttpEtaClient }, EtaSync],
})
export class FinanceModule {}
