import { Inject, Injectable, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { onEvent } from '../platform';
import { ParcelsController } from './parcels.controller';
import { ParcelsService } from './parcels.service';

@Injectable()
class ParcelsWiring implements OnModuleInit {
  constructor(@Inject(ParcelsService) private readonly parcels: ParcelsService) {}
  onModuleInit() {
    // An unclear address got its area from the Location queue: route and price the parcel now.
    onEvent('location.resolved', 'parcels.route', async (payload, tx) => {
      const p = payload as { refType: string; refId: string; decisionId: string; placeId: string };
      if (p.refType !== 'parcel') return;
      const parcel = await tx.parcel.findUnique({ where: { id: p.refId } });
      if (parcel?.decisionId === p.decisionId) await this.parcels.applyPlace(tx, p.refId, p.placeId);
    });
  }
}

@Module({})
export class ParcelsModule {
  static register(location: DynamicModule, merchants: DynamicModule, money: DynamicModule): DynamicModule {
    return {
      module: ParcelsModule,
      imports: [location, merchants, money],
      controllers: [ParcelsController],
      providers: [ParcelsService, ParcelsWiring],
      exports: [ParcelsService],
    };
  }
}
