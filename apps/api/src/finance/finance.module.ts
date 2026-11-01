import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { BooksController } from './books.controller';
import { ControlsController } from './controls.controller';
import { FinanceController } from './finance.controller';

@Module({
  imports: [CoverageModule],
  controllers: [FinanceController, BooksController, ControlsController],
})
export class FinanceModule {}
