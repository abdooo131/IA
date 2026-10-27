import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock, SystemClock } from '../common/clock';
import type { Env } from '../config/env';
import { CoverageController } from './coverage.controller';
import { CoverageService } from './coverage.service';
import { Geocoder, GoogleGeocoder, NotConfiguredGeocoder, OsmGeocoder } from './geocoding';
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
        if (key) return new GoogleGeocoder(key);
        // OpenStreetMap is for local testing only; production needs the Google key.
        const osm =
          config.get('GEOCODER', { infer: true }) === 'osm' &&
          config.get('NODE_ENV', { infer: true }) !== 'production';
        return osm ? new OsmGeocoder() : new NotConfiguredGeocoder();
      },
    },
  ],
  exports: [StoreStatusService, Clock, CoverageService, Geocoder],
})
export class CoverageModule {}
