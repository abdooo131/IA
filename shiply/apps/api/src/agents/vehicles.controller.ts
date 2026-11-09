import { Body, Controller, Get, HttpException, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { DB, NeedAccess, parse } from '../platform';
import { ComplianceService } from './compliance.service';

/** Plates as people type them: spaces and dashes dropped, Latin letters upper case. */
export const plate = (s: string) => s.replace(/[\s\-_]/g, '').toUpperCase();

const VehicleBody = z.object({
  agentId: z.string().min(1),
  plate: z.string().trim().min(2).max(20).transform(plate),
  type: z.enum(['motorbike', 'car', 'van', 'truck']),
  capacityKg: z.number().int().min(0).max(40_000).optional(),
  personId: z.string().optional(),
});
const DocumentBody = z
  .object({
    personId: z.string().optional(),
    vehicleId: z.string().optional(),
    kind: z.enum(['national_id', 'driving_licence', 'vehicle_licence', 'insurance', 'criminal_record']),
    number: z.string().trim().min(1).max(40),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(s)).optional(),
  })
  .refine((d) => !!d.personId !== !!d.vehicleId, { message: 'person_or_vehicle' });

@Controller('agents')
export class VehiclesController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
  ) {}

  @Get('vehicles')
  @NeedAccess('fleet', 'view')
  list(@Query('agent') agent?: string) {
    return this.db.vehicle.findMany({ where: agent ? { agentId: agent } : {}, orderBy: { plate: 'asc' } });
  }

  @Post('vehicles')
  @NeedAccess('fleet', 'use')
  async create(@Body() body: unknown) {
    const b = parse(VehicleBody, body);
    if (await this.db.vehicle.findUnique({ where: { plate: b.plate } })) throw new HttpException({ error: 'plate_taken' }, 409);
    const v = await this.db.vehicle.create({ data: { ...b, personId: b.personId ?? null } });
    if (v.personId) await this.compliance.check(new Date(), [v.personId]);
    return v;
  }

  @Patch('vehicles/:id')
  @NeedAccess('fleet', 'use')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ personId: z.string().nullable().optional(), active: z.boolean().optional(), capacityKg: z.number().int().min(0).max(40_000).optional() }), body);
    const before = await this.db.vehicle.findUnique({ where: { id } });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    const v = await this.db.vehicle.update({ where: { id }, data: b });
    const affected = [before.personId, v.personId].filter((x): x is string => !!x);
    if (affected.length) await this.compliance.check(new Date(), affected);
    return v;
  }

  @Post('documents')
  @NeedAccess('fleet', 'use')
  async document(@Body() body: unknown, @Req() req: Request) {
    const b = parse(DocumentBody, body);
    const d = await this.db.document.create({ data: { personId: b.personId ?? null, vehicleId: b.vehicleId ?? null, kind: b.kind, number: b.number, expiresAt: b.expiresAt ?? null, createdById: req.user!.id } });
    const personId = b.personId ?? (await this.db.vehicle.findUnique({ where: { id: b.vehicleId! } }))?.personId;
    if (personId) await this.compliance.check(new Date(), [personId]);
    return d;
  }

  @Get('compliance')
  @NeedAccess('fleet', 'view')
  report() {
    return this.compliance.report();
  }
}
