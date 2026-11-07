import { ParseIdPipe } from '../common/id.pipe';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles, assertHubAccess, type SessionUser } from '../auth/auth';
import { HubService } from './hub.service';

/** Hub operations. Staff work in their own hub; admin can open any hub. */
@Controller('hubs/:hubId')
@Roles('ADMIN', 'HUB_STAFF')
export class HubController {
  constructor(private readonly hub: HubService) {}

  private check(user: SessionUser, hubId: string) {
    assertHubAccess(user, hubId);
    return hubId;
  }

  @Post('inbound')
  @HttpCode(200)
  inbound(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    return this.hub.inbound(this.check(u, hubId), body, u);
  }

  @Get('info')
  info(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.hub(this.check(u, hubId));
  }

  @Post('outbound/bag')
  @HttpCode(200)
  bagParcel(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    return this.hub.bagParcel(this.check(u, hubId), body, u);
  }

  @Get('lanes')
  lanes(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.lanes(this.check(u, hubId));
  }

  @Get('arrivals')
  arrivals(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.openArrivals(this.check(u, hubId));
  }

  @Post('bags/:bagId/check')
  @HttpCode(200)
  checkBag(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('bagId', ParseIdPipe) bagId: string) {
    return this.hub.checkBag(this.check(u, hubId), bagId, u);
  }

  @Get('handover-check')
  handoverCheck(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.handoverCheck(this.check(u, hubId));
  }

  @Get('on-hand')
  onHand(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.onHand(this.check(u, hubId));
  }

  @Get('pickups')
  pickups(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Query('date') date?: string) {
    return this.hub.pickups(this.check(u, hubId), date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
  }

  @Post('pickups/:id/assign')
  @HttpCode(200)
  async assign(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    await this.hub.assignPickup(this.check(u, hubId), id, body, u);
    return { ok: true };
  }

  @Get('couriers')
  couriers(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.couriers(this.check(u, hubId));
  }

  @Post('sort')
  @HttpCode(200)
  sort(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    return this.hub.sort(this.check(u, hubId), body, u);
  }

  @Get('bags')
  bags(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.bags(this.check(u, hubId));
  }

  @Get('bags/:bagId')
  bag(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('bagId', ParseIdPipe) bagId: string) {
    return this.hub.bag(this.check(u, hubId), bagId);
  }

  @Post('bags/:bagId/remove')
  @HttpCode(200)
  async removeFromBag(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('bagId', ParseIdPipe) bagId: string, @Body() body: unknown) {
    await this.hub.removeFromBag(this.check(u, hubId), bagId, body, u);
    return { ok: true };
  }

  @Post('bags/:bagId/seal')
  @HttpCode(200)
  async seal(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('bagId', ParseIdPipe) bagId: string) {
    await this.hub.sealBag(this.check(u, hubId), bagId, u);
    return { ok: true };
  }

  @Post('receive-bag')
  @HttpCode(200)
  receiveBag(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    return this.hub.receiveBag(this.check(u, hubId), body, u);
  }

  @Get('trips')
  trips(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.trips(this.check(u, hubId));
  }

  @Post('trips')
  createTrip(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    return this.hub.createTrip(this.check(u, hubId), body, u);
  }

  @Post('trips/:tripId/load')
  @HttpCode(200)
  load(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('tripId', ParseIdPipe) tripId: string, @Body() body: unknown) {
    return this.hub.loadBag(this.check(u, hubId), tripId, body, u);
  }

  @Post('trips/:tripId/unload')
  @HttpCode(200)
  async unload(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('tripId', ParseIdPipe) tripId: string, @Body() body: unknown) {
    await this.hub.unloadBag(this.check(u, hubId), tripId, body, u);
    return { ok: true };
  }

  @Post('trips/:tripId/depart')
  @HttpCode(200)
  depart(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('tripId', ParseIdPipe) tripId: string) {
    return this.hub.depart(this.check(u, hubId), tripId, u);
  }

  @Post('trips/:tripId/close')
  @HttpCode(200)
  closeTrip(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('tripId', ParseIdPipe) tripId: string) {
    return this.hub.closeTrip(this.check(u, hubId), tripId, u);
  }

  @Get('runs')
  runs(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.runs(this.check(u, hubId));
  }

  @Get('customer-returns')
  customerReturns(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    return this.hub.customerReturns(this.check(u, hubId));
  }

  @Get('runs/:runId')
  run(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('runId', ParseIdPipe) runId: string) {
    return this.hub.run(this.check(u, hubId), runId);
  }

  @Post('runs')
  createRun(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    return this.hub.createRun(this.check(u, hubId), body, u);
  }

  @Post('runs/:runId/add')
  @HttpCode(200)
  add(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('runId', ParseIdPipe) runId: string, @Body() body: unknown) {
    return this.hub.addToRun(this.check(u, hubId), runId, body, u);
  }

  @Post('runs/:runId/remove')
  @HttpCode(200)
  async remove(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('runId', ParseIdPipe) runId: string, @Body() body: unknown) {
    await this.hub.removeFromRun(this.check(u, hubId), runId, body, u);
    return { ok: true };
  }

  @Post('runs/:runId/start')
  @HttpCode(200)
  start(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('runId', ParseIdPipe) runId: string) {
    return this.hub.startRun(this.check(u, hubId), runId, u);
  }

  @Post('runs/:runId/close')
  @HttpCode(200)
  close(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('runId', ParseIdPipe) runId: string, @Body() body: unknown) {
    return this.hub.closeRun(this.check(u, hubId), runId, body, u);
  }
}
