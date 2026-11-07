import { ParseIdPipe } from '../common/id.pipe';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Roles, assertHubAccess, type SessionUser } from '../auth/auth';
import { ControlService } from './control.service';

function sendFile(res: Response, f: { data: Uint8Array; mime: string; name: string }) {
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(f.data));
}

/** Operations: quality tickets, lost and damaged parcels, the control job. */
@Controller('control')
@Roles('ADMIN')
export class ControlController {
  constructor(private readonly c: ControlService) {}

  @Get('tickets')
  tickets(@Query('status') status?: string) {
    return this.c.tickets({ status: status || undefined });
  }

  @Post('tickets')
  create(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.c.createTicket(body, u);
  }

  @Get('tickets/:id/photo')
  async photo(@Param('id', ParseIdPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.c.ticketPhoto(id));
  }

  @Get('attempts')
  attempts(@Query('status') status?: string) {
    return this.c.attempts({ status });
  }

  @Post('attempts/:id/review')
  @HttpCode(200)
  review(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    return this.c.reviewAttempt(id, body, u);
  }

  @Get('stops/:id/photo')
  async stopPhoto(@Param('id', ParseIdPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.c.stopPhoto(id));
  }

  @Get('couriers/live')
  live() {
    return this.c.liveCouriers();
  }

  @Get('couriers/:id/trail')
  trail(@Param('id', ParseIdPipe) id: string, @Query('date') date: string) {
    return this.c.trail(id, date ?? '');
  }

  @Put('tickets/:id/penalty')
  @HttpCode(200)
  penalty(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    return this.c.setPenalty(id, body, u);
  }

  @Post('tickets/:id/override')
  @HttpCode(200)
  override(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    return this.c.override(id, body, u);
  }

  @Post('tickets/:id/decide')
  @HttpCode(200)
  decide(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    return this.c.decideAppeal(id, body, u);
  }

  @Get('lost')
  lost() {
    return this.c.lostParcels();
  }

  @Get('trips/:id/manifest')
  manifest(@Param('id', ParseIdPipe) id: string) {
    return this.c.manifest(id);
  }

  @Get('pallets/:id/photo/:which')
  async palletPhoto(@Param('id', ParseIdPipe) id: string, @Param('which') which: string, @Res() res: Response) {
    sendFile(res, await this.c.palletPhoto(id, which === 'in' ? 'in' : 'out'));
  }

  /** Runs the control checks now instead of waiting for the next round. */
  @Post('jobs/tick')
  @HttpCode(200)
  tick() {
    return this.c.tick();
  }
}

/** The hub floor: damage reports, pallets, trip manifests. */
@Controller('hubs/:hubId')
@Roles('ADMIN', 'HUB_STAFF')
export class HubControlController {
  constructor(private readonly c: ControlService) {}

  @Post('damaged')
  @HttpCode(200)
  damaged(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.c.reportDamage(hubId, body, u);
  }

  @Get('pallets')
  pallets(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string) {
    assertHubAccess(u, hubId);
    return this.c.pallets(hubId);
  }

  @Post('pallets')
  createPallet(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.c.createPallet(hubId, body, u);
  }

  @Post('pallets/:palletId/bags')
  @HttpCode(200)
  addBag(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('palletId', ParseIdPipe) palletId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.c.addBag(hubId, palletId, body, u);
  }

  @Post('pallets/:palletId/remove')
  @HttpCode(200)
  removeBag(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('palletId', ParseIdPipe) palletId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.c.removeBag(hubId, palletId, body, u);
  }

  @Post('pallets/:palletId/seal')
  @HttpCode(200)
  seal(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('palletId', ParseIdPipe) palletId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.c.sealPallet(hubId, palletId, body, u);
  }

  @Post('pallets/:palletId/receive')
  @HttpCode(200)
  receive(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('palletId', ParseIdPipe) palletId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.c.receivePallet(hubId, palletId, body, u);
  }

  @Post('trips/:tripId/load-pallet')
  @HttpCode(200)
  loadPallet(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('tripId', ParseIdPipe) tripId: string, @Body() body: unknown) {
    assertHubAccess(u, hubId);
    return this.c.loadPallet(hubId, tripId, body, u);
  }

  @Get('trips/:tripId/manifest')
  manifest(@CurrentUser() u: SessionUser, @Param('hubId', ParseIdPipe) hubId: string, @Param('tripId', ParseIdPipe) tripId: string) {
    assertHubAccess(u, hubId);
    return this.c.manifest(tripId);
  }
}

/** A courier or agent sees their tickets and appeals a penalty. */
@Controller()
@Roles('COURIER', 'AGENT')
export class TicketAppealController {
  constructor(private readonly c: ControlService) {}

  @Get('my/tickets')
  mine(@CurrentUser() u: SessionUser) {
    return u.role === 'COURIER' ? this.c.tickets({ courierId: u.id }) : this.c.tickets({ agentId: u.agentId ?? 'none' });
  }

  @Post('my/tickets/:id/appeal')
  @HttpCode(200)
  appeal(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string, @Body() body: unknown) {
    return this.c.appeal(id, body, u);
  }
}
