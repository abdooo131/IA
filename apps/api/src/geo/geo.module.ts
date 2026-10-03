import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { GEOCODER, MockGeocoder } from './geocoder.adapter';
import { ZoneService } from './zone.service';

@Module({
  imports: [AppConfigModule],
  providers: [{ provide: GEOCODER, useClass: MockGeocoder }, ZoneService],
  exports: [ZoneService, GEOCODER],
})
export class GeoModule {}
