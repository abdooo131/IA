import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { PushModule } from '../push/push.module';
import { TicketsModule } from '../tickets/tickets.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [TicketsModule, PushModule, EmailModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
