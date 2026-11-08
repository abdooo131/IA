import { ShopAdminController, ShopController } from './shop/shop.controller';
import { ShopService } from './shop/shop.service';
// The Shiply parcel network inside Shiply Now's API. Every route sits under /parcels (see
// app.module's RouterModule). Sign in, errors and the books are Shiply Now's; the guard below
// gives network routes the person as the network knows them.
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import {
  AdminAgentsController,
  AgentPortalController,
  CourierShiftController,
  JoinController,
} from './agents/agents.controller';
import { AgentsService } from './agents/agents.service';
import { ApiKeyGuard } from './api/api-key';
import { DeveloperService } from './api/developer.service';
import { DeveloperController, V1Controller, WebhookSender } from './api/v1.controller';
import { V1Service } from './api/v1.service';
import { ParcelsGuard } from './auth/auth';
import { AuthController } from './auth/auth.controller';
import { PrismaService } from './common/prisma.service';
import { SettingsService } from './common/settings.service';
import {
  ControlController,
  HubControlController,
  TicketAppealController,
} from './control/control.controller';
import { ControlService } from './control/control.service';
import { ShipmentsCore } from './core/shipments.core';
import { CourierController } from './courier/courier.controller';
import { CourierService } from './courier/courier.service';
import { BooksService } from './finance/books.service';
import {
  AgentMoneyController,
  CourierMoneyController,
  FinanceController,
  HubSafeController,
} from './finance/finance.controller';
import { FinanceService } from './finance/finance.service';
import { HubController } from './hub/hub.controller';
import { HubService } from './hub/hub.service';
import {
  ShopifyMerchantController,
  ShopifyPublicController,
} from './integrations/shopify.controller';
import { ShopifyService } from './integrations/shopify.service';
import { MerchantDeskService } from './merchant/desk.service';
import {
  AdminDeskController,
  MerchantController,
  MerchantDeskController,
  PublicDeskController,
} from './merchant/merchant.controller';
import { MerchantService } from './merchant/merchant.service';
import { PublicController } from './public/public.controller';

@Module({
  controllers: [
    ShopAdminController,
    ShopController,
    AuthController,
    MerchantController,
    HubController,
    CourierController,
    AdminController,
    PublicController,
    AdminAgentsController,
    AgentPortalController,
    CourierShiftController,
    JoinController,
    FinanceController,
    CourierMoneyController,
    HubSafeController,
    AgentMoneyController,
    ControlController,
    HubControlController,
    TicketAppealController,
    MerchantDeskController,
    PublicDeskController,
    AdminDeskController,
    V1Controller,
    DeveloperController,
    ShopifyPublicController,
    ShopifyMerchantController,
  ],
  providers: [
    ShopService,
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
    MerchantDeskService,
    V1Service,
    ShopifyService,
    DeveloperService,
    WebhookSender,
    ApiKeyGuard,
    { provide: APP_GUARD, useClass: ParcelsGuard },
  ],
})
export class ParcelsModule {}
