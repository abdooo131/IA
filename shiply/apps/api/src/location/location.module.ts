import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { atLeast } from '@shiply/shared';
import { HomeRegistry } from '../platform';
import { FinderController } from './finder.controller';
import { GazetteerCache } from './gazetteer.cache';
import { LocationService } from './location.service';
import { QueueController } from './queue.controller';

/** Addresses waiting for a person show on Home for whoever can work the queue. */
@Injectable()
class LocationHome implements OnModuleInit {
  constructor(
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
    @Inject(LocationService) private readonly location: LocationService,
  ) {}
  onModuleInit() {
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.location, 'use')) return [];
      const count = await this.location.openCount();
      return count ? [{ app: 'location', text: 'home.locationWaiting', values: { count }, href: '/location/queue', urgency: 2 }] : [];
    });
    this.home.addCount('location', async (user) => (atLeast(user.access.location, 'use') ? this.location.openCount() : 0));
  }
}

@Module({
  controllers: [QueueController, FinderController],
  providers: [GazetteerCache, LocationService, LocationHome],
  exports: [LocationService, GazetteerCache],
})
export class LocationModule {}
