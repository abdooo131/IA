import { Module } from '@nestjs/common';
import { StoreAccessService } from '../store/store-access.service';
import { PackagingController, StorePackagingController } from './packaging.controller';

@Module({
  controllers: [PackagingController, StorePackagingController],
  providers: [StoreAccessService],
})
export class PackagingModule {}
