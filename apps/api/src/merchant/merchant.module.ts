import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MerchantOrdersController } from './merchant-orders.controller';
import { MerchantController } from './merchant.controller';

@Module({
  imports: [OrdersModule],
  controllers: [MerchantController, MerchantOrdersController],
})
export class MerchantModule {}
