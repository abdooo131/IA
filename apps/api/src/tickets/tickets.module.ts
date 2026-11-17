import { Module } from '@nestjs/common';
import { HttpSlack, Slack } from './slack';
import { SlackController } from './slack.controller';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [TicketsController, SlackController],
  providers: [TicketsService, { provide: Slack, useClass: HttpSlack }],
  exports: [TicketsService],
})
export class TicketsModule {}
