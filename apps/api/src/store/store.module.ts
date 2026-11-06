import { Module } from '@nestjs/common';
import { StoreAccessService } from './store-access.service';
import { StoreOrdersController } from './store-orders.controller';
import { StoreCashController } from './store-cash.controller';
import { StorePettyController } from './store-petty.controller';
import { StoreController } from './store.controller';
import { StoreReturnsController } from './store-returns.controller';
import { StoreTransfersController } from './store-transfers.controller';

@Module({
  controllers: [
    StoreController,
    StoreOrdersController,
    StoreCashController,
    StorePettyController,
    StoreReturnsController,
    StoreTransfersController,
  ],
  providers: [StoreAccessService],
})
export class StoreModule {}
