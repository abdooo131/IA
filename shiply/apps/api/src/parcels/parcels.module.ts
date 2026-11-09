import { Inject, Injectable, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { atLeast } from '@shiply/shared';
import { HomeRegistry, onEvent } from '../platform';
import { BagsService } from './bags.service';
import { FacilityController } from './facility.controller';
import { FacilityService } from './facility.service';
import { GapsService } from './gaps.service';
import { CourierService } from './courier.service';
import { HubController } from './hub.controller';
import { HubService } from './hub.service';
import { RunsService } from './runs.service';
import { ParcelsController } from './parcels.controller';
import { ParcelsService } from './parcels.service';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';

@Injectable()
class ParcelsWiring implements OnModuleInit {
  constructor(
    @Inject(ParcelsService) private readonly parcels: ParcelsService,
    @Inject(GapsService) private readonly gaps: GapsService,
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
  ) {}
  onModuleInit() {
    // An unclear address got its area from the Location queue: route and price the parcel now.
    onEvent('location.resolved', 'parcels.route', async (payload, tx) => {
      const p = payload as { refType: string; refId: string; decisionId: string; placeId: string };
      if (p.refType !== 'parcel') return;
      const parcel = await tx.parcel.findUnique({ where: { id: p.refId } });
      if (parcel?.decisionId === p.decisionId) await this.parcels.applyPlace(tx, p.refId, p.placeId);
    });
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.shiply, 'manage')) return [];
      const count = await this.gaps.openCount();
      return count ? [{ app: 'shiply', text: 'home.parcelGaps', values: { count }, href: '/shiply/gaps', urgency: 1 }] : [];
    });
    this.home.addCount('shiply', async (user) => (atLeast(user.access.shiply, 'manage') ? this.gaps.openCount() : 0));
  }
}

@Module({})
export class ParcelsModule {
  static register(location: DynamicModule, merchants: DynamicModule, money: DynamicModule): DynamicModule {
    return {
      module: ParcelsModule,
      imports: [location, merchants, money],
      controllers: [ScanController, PickupsController, FacilityController, HubController, ParcelsController],
      providers: [ParcelsService, ScanService, PickupsService, GapsService, FacilityService, BagsService, HubService, RunsService, CourierService, ParcelsWiring],
      exports: [ParcelsService],
    };
  }
}
