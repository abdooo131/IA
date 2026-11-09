import { Module, type DynamicModule } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { PeopleController } from './people.controller';

@Module({})
export class AgentsModule {
  static register(money: DynamicModule): DynamicModule {
    return {
      module: AgentsModule,
      imports: [money],
      controllers: [PeopleController, AgentsController],
      providers: [AgentsService],
      exports: [AgentsService],
    };
  }
}
