import { Module, OnModuleInit } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { JobsService } from '../jobs/jobs.service';
import { OrdersModule } from '../orders/orders.module';
import { AlertsService } from './alerts.service';
import { DriverCashService } from './cash.service';
import { DispatchService } from './dispatch.service';
import { DriversService } from './drivers.service';
import { HubService } from './hub.service';
import { OperationsController } from './operations.controller';
import { RunSheetService } from './runsheet.service';

@Module({
  imports: [AppConfigModule, OrdersModule],
  controllers: [OperationsController],
  providers: [DriversService, DispatchService, HubService, DriverCashService, RunSheetService, AlertsService],
  exports: [AlertsService, DriversService],
})
export class OperationsModule implements OnModuleInit {
  constructor(private readonly jobs: JobsService, private readonly hubs: HubService) {}

  async onModuleInit() {
    this.jobs.register('transfer-check', () => this.hubs.checkOverdueTransfers());
    if (process.env.REDIS_URL) await this.jobs.schedule('transfer-check', '*/15 * * * *', 'Africa/Cairo').catch(() => undefined);
  }
}
