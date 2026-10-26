import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { OrdersModule } from '../orders/orders.module';
import { MerchantOrdersController } from './merchant-orders.controller';
import { MerchantFinanceController } from './merchant-finance.controller';
import { MerchantController } from './merchant.controller';

@Module({
  imports: [OrdersModule, CoverageModule],
  controllers: [MerchantController, MerchantOrdersController, MerchantFinanceController],
})
export class MerchantModule {}
