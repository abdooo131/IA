import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock, SystemClock } from '../common/clock';
import type { Env } from '../config/env';
import { CoverageController } from './coverage.controller';
import { CoverageService } from './coverage.service';
import { Geocoder, GoogleGeocoder, NotConfiguredGeocoder } from './geocoding';
import { StoreStatusService } from './store-status.service';

@Module({
  controllers: [CoverageController],
  providers: [
    CoverageService,
    StoreStatusService,
    { provide: Clock, useClass: SystemClock },
    {
      provide: Geocoder,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const key = config.get('GOOGLE_MAPS_API_KEY', { infer: true });
        return key ? new GoogleGeocoder(key) : new NotConfiguredGeocoder();
      },
    },
  ],
  exports: [StoreStatusService, Clock],
})
export class CoverageModule {}
