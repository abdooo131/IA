import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { PrismaClient } from '@shiply/db';
import { AccessGuard } from './access/access.guard';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/session.guard';
import { HomeRegistry } from './home/home.registry';
import { MeController } from './home/me.controller';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { DeadLettersAttention, DeadLettersController } from './events/dead-letters.controller';
import { DB } from './tokens';
import { RolesController } from './users/roles.controller';
import { UsersController } from './users/users.controller';

@Module({})
export class PlatformModule {
  static forRoot(db: PrismaClient): DynamicModule {
    return {
      module: PlatformModule,
      global: true,
      controllers: [AuthController, MeController, UsersController, SettingsController, AuditController, DeadLettersController, RolesController],
      providers: [
        { provide: DB, useValue: db },
        AuthService,
        SettingsService,
        AuditService,
        HomeRegistry,
        DeadLettersAttention,
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
      exports: [DB, AuthService, SettingsService, AuditService, HomeRegistry],
    };
  }
}
