import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccountingModule } from './accounting/accounting.module';
import { LedgerModule } from './accounting/ledger.module';
import { AdminModule } from './admin/admin.module';
import { JobsModule } from './jobs/jobs.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/guards';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { HealthController } from './health/health.controller';
import { MerchantsModule } from './merchants/merchants.module';
import { OperationsModule } from './operations/operations.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    JwtModule.register({ global: true }),
    PrismaModule,
    AuditModule,
    JobsModule,
    LedgerModule,
    AuthModule,
    OrdersModule,
    MerchantsModule,
    AdminModule,
    AccountingModule,
    OperationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
