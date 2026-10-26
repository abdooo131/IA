import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { FinanceController } from './finance.controller';

@Module({
  imports: [CoverageModule],
  controllers: [FinanceController],
})
export class FinanceModule {}
