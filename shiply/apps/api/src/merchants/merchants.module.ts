import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { atLeast } from '@shiply/shared';
import { DB, HomeRegistry, onEvent } from '../platform';
import type { PrismaClient } from '@shiply/db';
import { LocationModule } from '../location';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Injectable()
class MerchantsWiring implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
    @Inject(MerchantsService) private readonly merchants: MerchantsService,
  ) {}
  onModuleInit() {
    // An unclear pickup address got its area from the Location queue.
    onEvent('location.resolved', 'merchants.pickup', async (payload, tx) => {
      const p = payload as { refType: string; refId: string; decisionId: string; placeId: string };
      if (p.refType === 'merchant_pickup') await this.merchants.pickupResolved(tx, p.refId, p.decisionId, p.placeId);
    });
    const waiting = () => this.db.merchant.count({ where: { status: 'pending' } });
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.merchants, 'manage')) return [];
      const count = await waiting();
      return count ? [{ app: 'merchants', text: 'home.signupsWaiting', values: { count }, href: '/merchants/signups', urgency: 3 }] : [];
    });
    const pendingContracts = () => this.db.contractVersion.count({ where: { status: 'pending' } });
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.sales, 'manage')) return [];
      const count = await pendingContracts();
      return count ? [{ app: 'merchants', text: 'home.contractsWaiting', values: { count }, href: '/merchants/contracts', urgency: 2 }] : [];
    });
    this.home.addCount('merchants', async (user) => (atLeast(user.access.merchants, 'manage') ? waiting() : 0));
  }
}

@Module({})
export class MerchantsModule {
  static register(location: ReturnType<typeof LocationModule.register>) {
    return {
      module: MerchantsModule,
      imports: [location],
      controllers: [ContractsController, MerchantsController],
      providers: [MerchantsService, ContractsService, MerchantsWiring],
      exports: [MerchantsService],
    };
  }
}
