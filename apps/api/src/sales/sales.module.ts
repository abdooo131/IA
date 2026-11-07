import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesController } from './sales.controller';

/** The Sales app: CRM companies, contacts, deals, activities (docs/SALES.md). */
@Module({
  imports: [AuthModule],
  controllers: [SalesController],
})
export class SalesModule {}
