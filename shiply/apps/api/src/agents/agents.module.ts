import { Inject, Injectable, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { atLeast } from '@shiply/shared';
import { HomeRegistry } from '../platform';
import { ComplianceService } from './compliance.service';
import { VehiclesController } from './vehicles.controller';
import { RequestsController } from './requests.controller';
import { RoutesController } from './routes.controller';
import { WorkLogService } from './worklog.service';
import { SettlementsController } from './settlements.controller';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { PeopleController } from './people.controller';

@Injectable()
class AgentsWiring implements OnModuleInit {
  constructor(
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
  ) {}
  onModuleInit() {
    this.home.addAttention(async (user) => {
      if (!atLeast(user.access.fleet, 'use')) return [];
      const count = await this.compliance.expiringCount();
      return count ? [{ app: 'fleet', text: 'home.documentsExpiring', values: { count }, href: '/fleet/compliance', urgency: 2 }] : [];
    });
  }
}

@Module({})
export class AgentsModule {
  static register(money: DynamicModule): DynamicModule {
    return {
      module: AgentsModule,
      imports: [money],
      controllers: [PeopleController, VehiclesController, RequestsController, RoutesController, SettlementsController, AgentsController],
      providers: [AgentsService, ComplianceService, WorkLogService, AgentsWiring],
      exports: [AgentsService, ComplianceService],
    };
  }
}
