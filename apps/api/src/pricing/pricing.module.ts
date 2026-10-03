import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { PricingService } from './pricing.service';

@Module({ imports: [AppConfigModule], providers: [PricingService], exports: [PricingService] })
export class PricingModule {}
