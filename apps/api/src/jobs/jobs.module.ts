import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { TicketsModule } from '../tickets/tickets.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [TicketsModule, PushModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
