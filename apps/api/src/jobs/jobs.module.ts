import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { JobsService } from './jobs.service';

@Module({ imports: [TicketsModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
