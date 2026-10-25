import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CoverageModule } from './coverage/coverage.module';
import { validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
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
  ],
  controllers: [HealthController, UsersController],
})
export class AppModule {}
