import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { FAILED_ATTEMPT_REASONS } from '@shiply/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequestContext } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { parse } from '../common/zod';
import { AlertsService } from './alerts.service';
import { DriverCashService } from './cash.service';
import { DispatchService } from './dispatch.service';
import { DriversService } from './drivers.service';
import { HubService } from './hub.service';
import { RunSheetService } from './runsheet.service';

const OPS = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DISPATCH', 'HUB_STAFF', 'DRIVER_MANAGER'] as const;
const CASH = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'FINANCE', 'HUB_STAFF'] as const;
const Ids = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
const Code = z.object({ code: z.string().trim().min(3).max(40) });

@Controller('ops')
export class OperationsController {
  constructor(
    private readonly drivers: DriversService,
    private readonly dispatch: DispatchService,
    private readonly hubs: HubService,
    private readonly cash: DriverCashService,
    private readonly sheets: RunSheetService,
    private readonly alerts: AlertsService,
  ) {}

  // Drivers
  @Get('drivers')
  @Roles(...OPS, 'FINANCE')
  listDrivers(@Ctx() ctx: RequestContext, @Query() q: unknown) {
    const p = parse(z.object({ type: z.enum(['PICKUP', 'DELIVERY']).optional(), hubId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional() }), q);
    return this.drivers.list(ctx, p);
  }

  @Post('drivers')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DRIVER_MANAGER')
  createDriver(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(
      z.object({
        type: z.enum(['PICKUP', 'DELIVERY']),
        fullName: z.string().trim().min(3).max(100),
        phone: z.string().trim().min(8).max(20),
        email: z.string().email().optional().nullable(),
        nationalId: z.string().trim().max(20).optional().nullable(),
        vehicle: z.enum(['MOTORCYCLE', 'CAR', 'VAN', 'BICYCLE', 'TRUCK']).optional(),
        hubId: z.string().uuid().optional().nullable(),
      }),
      body,
    );
    return this.drivers.create(ctx, b);
  }

  @Patch('drivers/:id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DRIVER_MANAGER')
  updateDriver(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        fullName: z.string().trim().min(3).max(100).optional(),
        phone: z.string().trim().min(8).max(20).optional(),
        vehicle: z.enum(['MOTORCYCLE', 'CAR', 'VAN', 'BICYCLE', 'TRUCK']).optional(),
        hubId: z.string().uuid().nullable().optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
      }),
      body,
    );
    return this.drivers.update(ctx, id, b);
  }

  @Get('drivers/:id/runsheet')
  @Roles(...OPS)
  async runsheet(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { fileName, pdf } = await this.sheets.build(ctx, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(pdf);
  }

  // Pickups
  @Get('pickups')
  @Roles(...OPS)
  pickups(@Ctx() ctx: RequestContext) {
    return this.dispatch.pickupQueue(ctx);
  }

  @Post('pickups/assign')
  @Roles(...OPS)
  assignPickup(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(Ids.extend({ driverId: z.string().uuid() }), body);
    return this.dispatch.assignPickup(ctx, b.ids, b.driverId);
  }

  @Post('pickups/picked-up')
  @Roles(...OPS)
  pickedUp(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.dispatch.markPickedUp(ctx, parse(Ids, body).ids);
  }

  // Hubs
  @Post('hubs/:hubId/receive')
  @Roles(...OPS)
  receive(@Ctx() ctx: RequestContext, @Param('hubId', ParseUUIDPipe) hubId: string, @Body() body: unknown) {
    return this.hubs.receive(ctx, hubId, parse(Code, body).code);
  }

  @Get('hubs/:hubId/inventory')
  @Roles(...OPS)
  inventory(@Ctx() ctx: RequestContext, @Param('hubId', ParseUUIDPipe) hubId: string) {
    return this.hubs.inventory(ctx, hubId);
  }

  // Transfers
  @Get('transfers')
  @Roles(...OPS)
  transfers(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.hubs.listTransfers(ctx, status);
  }

  @Post('transfers')
  @Roles(...OPS)
  createTransfer(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(z.object({ originHubId: z.string().uuid(), destinationHubId: z.string().uuid(), driverId: z.string().uuid().optional().nullable(), vehicle: z.string().max(40).optional().nullable() }), body);
    return this.hubs.createTransfer(ctx, b);
  }

  @Get('transfers/:id')
  @Roles(...OPS)
  transfer(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hubs.getTransfer(ctx, id);
  }

  @Post('transfers/:id/scan-out')
  @Roles(...OPS)
  scanOut(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.hubs.scanOut(ctx, id, parse(Code, body).code);
  }

  @Post('transfers/:id/dispatch')
  @Roles(...OPS)
  dispatchTransfer(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hubs.dispatch(ctx, id);
  }

  @Post('transfers/:id/scan-in')
  @Roles(...OPS)
  scanIn(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.hubs.scanIn(ctx, id, parse(Code, body).code);
  }

  @Post('transfers/:id/close')
  @Roles(...OPS)
  closeTransfer(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.hubs.closeTransfer(ctx, id);
  }

  // Deliveries
  @Get('deliveries')
  @Roles(...OPS)
  deliveries(@Ctx() ctx: RequestContext, @Query('hubId') hubId?: string) {
    return this.dispatch.deliveryBoard(ctx, hubId || undefined);
  }

  @Post('deliveries/assign')
  @Roles(...OPS)
  assignDelivery(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(Ids.extend({ driverId: z.string().uuid() }), body);
    return this.dispatch.assignDelivery(ctx, b.ids, b.driverId);
  }

  @Post('deliveries/out')
  @Roles(...OPS)
  out(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.dispatch.outForDelivery(ctx, parse(Ids, body).ids);
  }

  @Post('deliveries/delivered')
  @Roles(...OPS)
  delivered(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(Ids.extend({ note: z.string().max(300).optional() }), body);
    return this.dispatch.markDelivered(ctx, b.ids, b.note);
  }

  @Post('deliveries/failed')
  @Roles(...OPS)
  failed(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(Ids.extend({ reason: z.enum(FAILED_ATTEMPT_REASONS), note: z.string().max(300).optional() }), body);
    return this.dispatch.markFailed(ctx, b.ids, b.reason, b.note);
  }

  // Returns
  @Get('returns')
  @Roles(...OPS)
  returns(@Ctx() ctx: RequestContext) {
    return this.dispatch.returnsBoard(ctx);
  }

  @Post('returns/start')
  @Roles(...OPS)
  startReturn(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(Ids.extend({ note: z.string().max(300).optional() }), body);
    return this.dispatch.startReturn(ctx, b.ids, b.note);
  }

  @Post('returns/to-merchant')
  @Roles(...OPS)
  toMerchant(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(Ids.extend({ driverId: z.string().uuid() }), body);
    return this.dispatch.returnToMerchant(ctx, b.ids, b.driverId);
  }

  @Post('returns/returned')
  @Roles(...OPS)
  returned(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.dispatch.markReturned(ctx, parse(Ids, body).ids);
  }

  // Driver cash
  @Get('cash')
  @Roles(...CASH)
  cashSummary(@Ctx() ctx: RequestContext) {
    return this.cash.summary(ctx);
  }

  @Post('cash/handover')
  @Roles(...CASH)
  handover(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(z.object({ driverId: z.string().uuid(), receivedAmount: z.number().int().min(0), note: z.string().max(300).optional(), hubId: z.string().uuid().optional().nullable() }), body);
    return this.cash.handover(ctx, b);
  }

  @Post('cash/shortage-repaid')
  @Roles(...CASH)
  repaid(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(z.object({ driverId: z.string().uuid(), amount: z.number().int().positive(), note: z.string().max(300).optional() }), body);
    return this.cash.repayShortage(ctx, b.driverId, b.amount, b.note);
  }

  @Get('cash/history')
  @Roles(...CASH)
  cashHistory(@Ctx() ctx: RequestContext, @Query('driverId') driverId?: string) {
    return this.cash.history(ctx, driverId || undefined);
  }

  // Alerts
  @Get('alerts')
  @Roles(...OPS, 'FINANCE', 'QC_AGENT')
  listAlerts(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.alerts.list(ctx, status || 'OPEN');
  }

  @Post('alerts/:id/resolve')
  @Roles(...OPS, 'FINANCE')
  resolve(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.alerts.resolve(ctx, id, parse(z.object({ resolution: z.string().trim().min(3).max(300) }), body).resolution);
  }
}
