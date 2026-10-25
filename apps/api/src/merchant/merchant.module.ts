import { Module } from '@nestjs/common';
import { MerchantController } from './merchant.controller';

@Module({ controllers: [MerchantController] })
export class MerchantModule {}
