import { Module } from '@nestjs/common';
import { StoreAccessService } from './store-access.service';
import { StoreOrdersController } from './store-orders.controller';
import { StoreCashController } from './store-cash.controller';
import { StoreController } from './store.controller';
import { StoreReturnsController } from './store-returns.controller';

@Module({
  controllers: [
    StoreController,
    StoreOrdersController,
    StoreCashController,
    StoreReturnsController,
  ],
  providers: [StoreAccessService],
})
export class StoreModule {}
