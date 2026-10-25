import { Module } from '@nestjs/common';
import { StoreAccessService } from './store-access.service';
import { StoreController } from './store.controller';

@Module({
  controllers: [StoreController],
  providers: [StoreAccessService],
})
export class StoreModule {}
