import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { BooksController } from './books.controller';
import { ControlsController } from './controls.controller';
import { ProfitController } from './profit.controller';
import { FinanceController } from './finance.controller';

@Module({
  imports: [CoverageModule],
  controllers: [FinanceController, BooksController, ControlsController, ProfitController],
})
export class FinanceModule {}
