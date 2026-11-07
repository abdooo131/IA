import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AdminAgentsController, AgentPortalController, CourierShiftController, JoinController } from './agents/agents.controller';
import { AgentsService } from './agents/agents.service';
import { AgentMoneyController, CourierMoneyController, FinanceController, HubSafeController, MerchantBankController } from './finance/finance.controller';
import { BooksService } from './finance/books.service';
import { FinanceService } from './finance/finance.service';
import { ControlController, HubControlController, TicketAppealController } from './control/control.controller';
import { ControlService } from './control/control.service';
import { AuthGuard } from './auth/auth';
import { AuthController } from './auth/auth.controller';
import { ErrorFilter } from './common/errors';
import { PrismaService } from './common/prisma.service';
import { SettingsService } from './common/settings.service';
import { ShipmentsCore } from './core/shipments.core';
import { CourierController } from './courier/courier.controller';
import { CourierService } from './courier/courier.service';
import { HubController } from './hub/hub.controller';
import { HubService } from './hub/hub.service';
import { MerchantController } from './merchant/merchant.controller';
import { MerchantService } from './merchant/merchant.service';
import { PublicController } from './public/public.controller';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set to 32 characters or more');
  return secret;
}

@Module({
  imports: [JwtModule.registerAsync({ global: true, useFactory: () => ({ secret: jwtSecret(), signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }) })],
  controllers: [AuthController, MerchantController, HubController, CourierController, AdminController, PublicController, AdminAgentsController, AgentPortalController, CourierShiftController, JoinController, FinanceController, CourierMoneyController, HubSafeController, AgentMoneyController, MerchantBankController, ControlController, HubControlController, TicketAppealController],
  providers: [
    PrismaService,
    SettingsService,
    ShipmentsCore,
    MerchantService,
    HubService,
    CourierService,
    AdminService,
    AgentsService,
    FinanceService,
    BooksService,
    ControlService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
