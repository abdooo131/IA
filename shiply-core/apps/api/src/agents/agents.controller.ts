import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type SessionUser } from '../auth/auth';
import { DomainError } from '../common/errors';
import { parse } from '../common/validate';
import { AgentsService } from './agents.service';

const ResolveBody = z.object({ note: z.string().trim().max(300).default('') });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

function sendFile(res: Response, mime: string, data: Uint8Array, fileName: string) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(data));
}

function agentOf(u: SessionUser): string {
  if (!u.agentId) throw new DomainError('forbidden', 'Your account is not linked to an agent', 403);
  return u.agentId;
}

/** Operations: agents, their papers, staff, vehicles, attendance and alerts. */
@Controller('admin')
@Roles('ADMIN')
export class AdminAgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get('agents')
  list() {
    return this.agents.listAgents();
  }

  @Post('agents')
  create(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.agents.saveAgent(null, body, u);
  }

  @Get('agents/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.getAgent(id);
  }

  @Put('agents/:id')
  update(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.saveAgent(id, body, u);
  }

  @Post('agents/:id/documents')
  addDocument(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.addDocument(id, body, u);
  }

  @Get('agents/:id/documents/:docId')
  async document(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Res() res: Response) {
    const d = await this.agents.getDocument(id, docId);
    sendFile(res, d.mime, d.data, d.fileName);
  }

  @Post('agents/:id/logins')
  createLogin(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.createAgentLogin(id, body, u);
  }

  @Get('agents/:id/staff')
  staff(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.staff(id);
  }

  @Post('agents/:id/staff')
  createStaff(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.createStaff(id, body, u);
  }

  @Put('agents/:id/staff/:staffId')
  @HttpCode(200)
  updateStaff(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('staffId', ParseUUIDPipe) staffId: string, @Body() body: unknown) {
    return this.agents.updateStaff(id, staffId, body, u);
  }

  @Get('agents/:id/vehicles')
  vehicles(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.vehicles(id);
  }

  @Post('agents/:id/vehicles')
  addVehicle(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.saveVehicle(id, null, body, u);
  }

  @Put('agents/:id/vehicles/:vehicleId')
  updateVehicle(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Param('vehicleId', ParseUUIDPipe) vehicleId: string, @Body() body: unknown) {
    return this.agents.saveVehicle(id, vehicleId, body, u);
  }

  @Get('vehicle-requests')
  vehicleRequests(@Query('agentId') agentId?: string) {
    return this.agents.vehicleRequests(agentId ? { agentId } : {});
  }

  @Post('vehicle-requests')
  requestVehicle(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.agents.createVehicleRequest(body, u);
  }

  @Post('vehicle-requests/:id/done')
  @HttpCode(200)
  done(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.closeVehicleRequest(id, 'DONE', u);
  }

  @Post('vehicle-requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.closeVehicleRequest(id, 'CANCELLED', u);
  }

  @Get('attendance')
  attendance(@Query('date') date?: string, @Query('agentId') agentId?: string) {
    return this.agents.shifts({ date: parse(DATE, date), agentId: agentId || undefined });
  }

  @Get('attendance/:shiftId/photo')
  async photo(@Param('shiftId', ParseUUIDPipe) shiftId: string, @Res() res: Response) {
    const s = await this.agents.checkInPhoto(shiftId);
    sendFile(res, 'image/jpeg', s.checkInPhoto!, 'check-in.jpg');
  }

  @Get('alerts')
  alerts(@Query('status') status?: string, @Query('agentId') agentId?: string) {
    return this.agents.alerts({ status: status === 'RESOLVED' ? 'RESOLVED' : 'OPEN', agentId: agentId || undefined });
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.resolveAlert(id, parse(ResolveBody, body ?? {}).note, u);
  }

  /** Runs the attendance check now instead of waiting for the next minute. */
  @Post('jobs/attendance')
  @HttpCode(200)
  tick() {
    return this.agents.attendanceTick();
  }
}

/** The agent's own portal: only their staff, vehicles, shifts and alerts. */
@Controller('agent')
@Roles('AGENT')
export class AgentPortalController {
  constructor(private readonly agents: AgentsService) {}

  @Get('overview')
  overview(@CurrentUser() u: SessionUser) {
    return this.agents.overview(agentOf(u));
  }

  @Get('staff')
  staff(@CurrentUser() u: SessionUser) {
    return this.agents.staff(agentOf(u));
  }

  @Post('staff')
  createStaff(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.agents.createStaff(agentOf(u), body, u);
  }

  @Put('staff/:staffId')
  @HttpCode(200)
  updateStaff(@CurrentUser() u: SessionUser, @Param('staffId', ParseUUIDPipe) staffId: string, @Body() body: unknown) {
    return this.agents.updateStaff(agentOf(u), staffId, body, u);
  }

  @Get('vehicles')
  vehicles(@CurrentUser() u: SessionUser) {
    return this.agents.vehicles(agentOf(u));
  }

  @Post('vehicles')
  addVehicle(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.agents.saveVehicle(agentOf(u), null, body, u);
  }

  @Put('vehicles/:vehicleId')
  updateVehicle(@CurrentUser() u: SessionUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string, @Body() body: unknown) {
    return this.agents.saveVehicle(agentOf(u), vehicleId, body, u);
  }

  @Get('shifts')
  shifts(@CurrentUser() u: SessionUser, @Query('date') date?: string) {
    return this.agents.shifts({ agentId: agentOf(u), date: parse(DATE, date) });
  }

  @Post('shifts/:shiftId/answer')
  @HttpCode(200)
  answer(@CurrentUser() u: SessionUser, @Param('shiftId', ParseUUIDPipe) shiftId: string, @Body() body: unknown) {
    return this.agents.answerShift(agentOf(u), shiftId, body, u);
  }

  @Post('shifts/:shiftId/replacement')
  @HttpCode(200)
  replacement(@CurrentUser() u: SessionUser, @Param('shiftId', ParseUUIDPipe) shiftId: string, @Body() body: unknown) {
    return this.agents.assignReplacement(agentOf(u), shiftId, body, u);
  }

  @Get('vehicle-requests')
  vehicleRequests(@CurrentUser() u: SessionUser) {
    return this.agents.vehicleRequests({ agentId: agentOf(u) });
  }

  @Post('vehicle-requests/:id/provide')
  @HttpCode(200)
  provide(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.provideVehicle(agentOf(u), id, body, u);
  }

  @Get('alerts')
  alerts(@CurrentUser() u: SessionUser, @Query('status') status?: string) {
    return this.agents.alerts({ agentId: agentOf(u), status: status === 'RESOLVED' ? 'RESOLVED' : 'OPEN' });
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.agents.resolveAlert(id, parse(ResolveBody, body ?? {}).note, u, agentOf(u));
  }
}

/** Courier attendance: today's shift and check in with a photo. */
@Controller('courier')
@Roles('COURIER')
export class CourierShiftController {
  constructor(private readonly agents: AgentsService) {}

  @Get('shift')
  shift(@CurrentUser() u: SessionUser) {
    return this.agents.myShift(u);
  }

  @Post('check-in')
  @HttpCode(200)
  async checkIn(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    const s = await this.agents.checkIn(u, body);
    return { id: s.id, status: s.status, checkInAt: s.checkInAt, lateMinutes: s.lateMinutes };
  }
}

/** Public: a courier registers with their agent's code. */
@Controller('auth')
export class JoinController {
  constructor(private readonly agents: AgentsService) {}

  @Public()
  @Post('join')
  join(@Body() body: unknown) {
    return this.agents.join(body);
  }
}
