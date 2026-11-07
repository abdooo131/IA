import { TicketsModule } from './tickets/tickets.module';
import { ErrorReporterModule } from './common/error-reporter';
import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CoverageModule } from './coverage/coverage.module';
import { FinanceModule } from './finance/finance.module';
import { HrModule } from './hr/hr.module';
import { JobsModule } from './jobs/jobs.module';
import { MerchantModule } from './merchant/merchant.module';
import { PhotosModule } from './photos/photos.module';
import { RiderModule } from './rider/rider.module';
import { ShopifyModule } from './shopify/shopify.module';
import { StoreModule } from './store/store.module';
import { TrackingModule } from './tracking/tracking.module';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { PushModule } from './push/push.module';
import { EmailModule } from './email/email.module';
import { PackagingModule } from './packaging/packaging.module';
import { MeController } from './users/me.controller';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    ErrorReporterModule,
    ConfigModule.forRoot({
      isGlobal: true,
      // The single .env lives at the repo root. Real environment variables win over it.
      envFilePath: path.resolve(__dirname, '../../../.env'),
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    CoverageModule,
    AdminModule,
    StoreModule,
    MerchantModule,
    PhotosModule,
    RiderModule,
    JobsModule,
    FinanceModule,
    ShopifyModule,
    TrackingModule,
    TicketsModule,
    HrModule,
    PushModule,
    EmailModule,
    PackagingModule,
  ],
  controllers: [HealthController, UsersController, MeController],
})
export class AppModule {}
