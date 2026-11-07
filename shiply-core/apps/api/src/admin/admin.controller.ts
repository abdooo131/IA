import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles, type SessionUser } from '../auth/auth';
import { MerchantService } from '../merchant/merchant.service';
import { AdminService } from './admin.service';

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly merchants: MerchantService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('trend')
  trend(@Query('days') days?: string) {
    return this.admin.trend(days);
  }

  @Get('shipments')
  search(@Query() q: unknown) {
    return this.admin.search(q);
  }

  @Get('shipments/:id')
  shipment(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.shipment(id);
  }

  /** Create a parcel on behalf of a merchant. */
  @Post('merchants/:merchantId/shipments')
  createFor(@CurrentUser() u: SessionUser, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Body() body: unknown) {
    return this.merchants.create(merchantId, body, u.id);
  }

  @Post('shipments/:id/lost')
  @HttpCode(200)
  async lost(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { note?: string }) {
    await this.admin.markLost(id, u, String(body?.note ?? ''));
    return { ok: true };
  }

  @Get('hubs')
  hubs() {
    return this.admin.hubs();
  }

  @Post('hubs')
  createHub(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.admin.saveHub(null, body, u);
  }

  @Put('hubs/:id')
  updateHub(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.admin.saveHub(id, body, u);
  }

  @Get('zones')
  zones() {
    return this.admin.zones();
  }

  @Put('zones/:code')
  saveZone(@CurrentUser() u: SessionUser, @Param('code') code: string, @Body() body: unknown) {
    return this.admin.saveZone(code, body, u);
  }

  @Get('line-hauls')
  lineHauls() {
    return this.admin.lineHauls();
  }

  @Post('line-hauls')
  addLineHaul(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.admin.addLineHaul(body, u);
  }

  @Delete('line-hauls/:id')
  removeLineHaul(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.removeLineHaul(id, u);
  }

  @Get('route-preview')
  routePreview(@Query() q: unknown) {
    return this.admin.routePreview(q);
  }

  @Get('coverage')
  coverage() {
    return this.admin.coverage();
  }

  @Get('governorates')
  governorates() {
    return this.admin.governorates();
  }

  @Put('governorates/:code')
  saveGovernorate(@CurrentUser() u: SessionUser, @Param('code') code: string, @Body() body: unknown) {
    return this.admin.saveGovernorate(code, body, u);
  }

  @Post('areas')
  createArea(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.admin.saveArea(null, body, u);
  }

  @Put('areas/:id')
  updateArea(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.admin.saveArea(id, body, u);
  }

  @Get('merchants')
  merchantList() {
    return this.admin.merchants();
  }

  @Post('merchants')
  createMerchant(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.admin.saveMerchant(null, body, u);
  }

  @Put('merchants/:id')
  updateMerchant(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.admin.saveMerchant(id, body, u);
  }

  @Get('users')
  users() {
    return this.admin.users();
  }

  @Post('users')
  createUser(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.admin.createUser(body, u);
  }

  @Put('users/:id')
  async updateUser(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    await this.admin.updateUser(id, body, u);
    return { ok: true };
  }

  @Get('settings')
  settings() {
    return this.admin.settingsAll();
  }

  @Put('settings/:key')
  async saveSetting(@CurrentUser() u: SessionUser, @Param('key') key: string, @Body() body: { value?: unknown }) {
    await this.admin.saveSetting(key, body?.value, u);
    return { ok: true };
  }

  @Get('balances')
  balances() {
    return this.admin.balances();
  }

  @Get('merchants/:id/statement')
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.statement(id);
  }


  @Get('courier-cash')
  courierCash() {
    return this.admin.courierCash();
  }
}
