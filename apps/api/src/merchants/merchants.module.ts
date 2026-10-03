import { Module } from '@nestjs/common';
import { MerchantsController } from './merchants.controller';
import { ReferenceController } from './reference.controller';

@Module({ controllers: [MerchantsController, ReferenceController] })
export class MerchantsModule {}
