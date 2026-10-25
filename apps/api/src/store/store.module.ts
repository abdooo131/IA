import { Module } from '@nestjs/common';
import { StoreAccessService } from './store-access.service';
import { StoreOrdersController } from './store-orders.controller';
import { StoreController } from './store.controller';

@Module({
  controllers: [StoreController, StoreOrdersController],
  providers: [StoreAccessService],
})
export class StoreModule {}
