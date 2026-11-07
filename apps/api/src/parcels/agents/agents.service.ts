import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hashPassword, type Prisma, type CourierShift } from '@shiplynow/db';
import { cairoClock, cairoTimeToUtc, normalizeEgyptPhone } from '@shiplynow/shared/parcels';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { todayInCairo } from '../core/shipments.core';
import { openAlert, resolveAlerts } from './alerts';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, for example 09:00');

const AgentInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim(),
  email: z.string().trim().email().or(z.literal('')).default(''),
  supplies: z.enum(['PICKUP', 'DELIVERY', 'BOTH']).default('BOTH'),
  nationalIdNo: z.string().trim().max(20).default(''),
  commercialRegister: z.string().trim().max(40).default(''),
  taxCardNo: z.string().trim().max(40).default(''),
  bankName: z.string().trim().max(80).default(''),
  bankAccountName: z.string().trim().max(120).default(''),
  iban: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(EG\d{27})?$/, 'IBAN must be EG followed by 27 digits')
    .default(''),
  commissionBp: z.number().int().min(0).max(5000).nullish(),
  active: z.boolean().default(true),
});

const DocumentInput = z.object({
  kind: z.enum(['NATIONAL_ID', 'COMMERCIAL_REGISTER', 'TAX_CARD', 'CONTRACT', 'OTHER']),
  fileName: z.string().trim().min(1).max(160),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  dataBase64: z.string().min(8),
});

const AgentLoginInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

const StaffInput = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim(),
  password: z.string().min(8).max(200).optional(),
  courierType: z.enum(['PICKUP', 'DELIVERY']),
  hubId: z.string().min(1).max(64).nullish(),
  areaIds: z.array(z.string().min(1).max(64)).max(100).default([]),
  hubToHub: z.boolean().default(false),
  shiftStart: TIME.default('09:00'),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0, 1, 2, 3, 4, 6]),
  vehicleId: z.string().min(1).max(64).nullish(),
  active: z.boolean().optional(),
});

const JoinInput = z.object({
  agentCode: z.string().trim().toUpperCase().min(4).max(12),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim(),
  password: z.string().min(8).max(200),
  courierType: z.enum(['PICKUP', 'DELIVERY']),
});

const VehicleInput = z.object({
  plate: z.string().trim().toUpperCase().min(2).max(20),
  kind: z.enum(['VAN', 'BOX_TRUCK', 'PICKUP_TRUCK', 'CAR', 'MOTORCYCLE']),
  contract: z.enum(['FIXED', 'SPECIAL']).default('FIXED'),
  monthlyRent: z.number().int().min(0).default(0),
  capacityParcels: z.number().int().min(1).max(100000).nullish(),
  active: z.boolean().default(true),
});

const VehicleRequestInput = z.object({
  agentId: z.string().min(1).max(64),
  reason: z.enum(['MERCHANT_SPECIAL', 'BREAKDOWN', 'VEHICLE_FULL', 'OTHER']),
  merchantId: z.string().min(1).max(64).nullish(),
  hubId: z.string().min(1).max(64).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().int().min(0),
  notes: z.string().trim().max(500).default(''),
});

const ProvideInput = z.object({
  vehicleId: z.string().min(1).max(64).nullish(),
  driverName: z.string().trim().min(2).max(120),
  driverPhone: z.string().trim(),
  notes: z.string().trim().max(500).default(''),
});

const AnswerInput = z.discriminatedUnion('answer', [
  z.object({ answer: z.literal('LATE'), expectedTime: TIME }),
  z.object({ answer: z.literal('NOT_COMING') }),
]);

const ReplacementInput = z.object({ courierId: z.string().min(1).max(64) });

const CheckInInput = z.object({
  photoBase64: z.string().min(8),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

function decode(b64: string, max: number, what: string): Uint8Array<ArrayBuffer> {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0) throw new DomainError('invalid_input', `${what} is empty`, 422);
  if (buf.length > max)
    throw new DomainError(
      'invalid_input',
      `${what} is larger than ${Math.round(max / 1024 / 1024)} MB`,
      422,
    );
  return new Uint8Array(buf);
}

function phoneOrFail(input: string, what = 'Phone'): string {
  const phone = normalizeEgyptPhone(input);
  if (!phone)
    throw new DomainError('invalid_input', `${what} must be an Egyptian mobile number`, 422);
  return phone;
}

/**
 * Couriers sign in with their phone, but every account in Shiply Now has an email. Phone only
 * accounts get one that can never receive mail.
 */
export const phoneEmail = (phone: string) => `${phone.replace(/\D/g, '')}@phone.shiply.invalid`;

const STAFF_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  courierType: true,
  hubId: true,
  hubToHub: true,
  shiftStart: true,
  workDays: true,
  vehicleId: true,
  pendingApproval: true,
  isActive: true,
  createdAt: true,
  agentId: true,
  hub: { select: { code: true, name: true } },
  vehicle: { select: { plate: true } },
  courierAreas: { select: { areaId: true } },
} satisfies Prisma.UserSelect;

/**
 * Agents supply pickup and delivery staff and vehicles. This service covers the agent profile,
 * staff joining with the agent's code, vehicles, special vehicle requests, and attendance:
 * shifts, check in with a photo, the late alert, the agent's answer and the replacement window.
 */
@Injectable()
export class AgentsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    if (process.env.SHIPLY_JOBS === 'off') return;
    this.timer = setInterval(
      () => void this.attendanceTick().catch((e) => console.error('attendance tick', e)),
      60_000,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- admin: agents

  private async newAgentCode(tx: Tx): Promise<string> {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 20; i++) {
      const code =
        'AG' + Array.from({ length: 5 }, () => letters[randomInt(letters.length)]).join('');
      if (!(await tx.agent.findUnique({ where: { code } }))) return code;
    }
    throw new Error('could not make a unique agent code');
  }

  async listAgents() {
    const agents = await this.prisma.agent.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { vehicles: true, documents: true } } },
    });
    const staff = await this.prisma.user.groupBy({
      by: ['agentId', 'courierType'],
      where: { role: 'courier', agentId: { not: null } },
      _count: true,
    });
    const defaultBp = (await this.settings.all())['agents.default_commission_bp'];
    return agents.map((a) => ({
      ...a,
      effectiveCommissionBp: a.commissionBp ?? defaultBp,
      pickupStaff: staff.find((s) => s.agentId === a.id && s.courierType === 'PICKUP')?._count ?? 0,
      deliveryStaff:
        staff.find((s) => s.agentId === a.id && s.courierType === 'DELIVERY')?._count ?? 0,
    }));
  }

  async getAgent(id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: {
        documents: {
          select: { id: true, kind: true, fileName: true, mime: true, size: true, createdAt: true },
        },
        vehicles: true,
      },
    });
    if (!agent) throw notFound('Agent');
    const [logins, staff] = await Promise.all([
      this.prisma.user.findMany({
        where: { agentId: id, role: 'agent' },
        select: { id: true, name: true, email: true, isActive: true },
      }),
      this.prisma.user.findMany({
        where: { agentId: id, role: 'courier' },
        select: STAFF_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);
    const defaultBp = (await this.settings.all())['agents.default_commission_bp'];
    return { ...agent, effectiveCommissionBp: agent.commissionBp ?? defaultBp, logins, staff };
  }

  async saveAgent(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(AgentInput, body);
    const data = {
      ...d,
      phone: phoneOrFail(d.phone, 'Agent phone'),
      commissionBp: d.commissionBp ?? null,
    };
    return this.prisma.tx(async (tx) => {
      const agent = id
        ? await tx.agent.update({ where: { id }, data }).catch(() => {
            throw notFound('Agent');
          })
        : await tx.agent.create({ data: { ...data, code: await this.newAgentCode(tx) } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: id ? 'AGENT_UPDATED' : 'AGENT_CREATED',
          entityType: 'agent',
          entityId: agent.id,
          after: { ...data, iban: data.iban ? 'set' : '' },
        },
      });
      return agent;
    });
  }

  async addDocument(agentId: string, body: unknown, user: SessionUser) {
    const d = parse(DocumentInput, body);
    const data = decode(d.dataBase64, MAX_FILE_BYTES, 'The file');
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw notFound('Agent');
    const doc = await this.prisma.agentDocument.create({
      data: {
        agentId,
        kind: d.kind,
        fileName: d.fileName,
        mime: d.mime,
        size: data.length,
        data,
        uploadedById: user.id,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'AGENT_DOCUMENT_ADDED',
        entityType: 'agent',
        entityId: agentId,
        after: { kind: d.kind, fileName: d.fileName },
      },
    });
    return { id: doc.id };
  }

  async getDocument(agentId: string, docId: string) {
    const doc = await this.prisma.agentDocument.findFirst({ where: { id: docId, agentId } });
    if (!doc) throw notFound('Document');
    return doc;
  }

  async createAgentLogin(agentId: string, body: unknown, user: SessionUser) {
    const d = parse(AgentLoginInput, body);
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw notFound('Agent');
    if (await this.prisma.user.findUnique({ where: { email: d.email } }))
      throw new DomainError('duplicate', 'That email already has an account', 409);
    const login = await this.prisma.user.create({
      data: {
        email: d.email,
        name: d.name,
        phone: agent.phone,
        role: 'agent',
        agentId,
        passwordHash: await hashPassword(d.password),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'AGENT_LOGIN_CREATED',
        entityType: 'agent',
        entityId: agentId,
        after: { email: d.email },
      },
    });
    return { id: login.id };
  }

  // ---------------------------------------------------------------- staff

  /** Public: a courier joins with their agent's code and waits for the agent to approve. */
  async join(body: unknown) {
    const d = parse(JoinInput, body);
    const phone = phoneOrFail(d.phone);
    const agent = await this.prisma.agent.findUnique({ where: { code: d.agentCode } });
    if (!agent || !agent.active)
      throw new DomainError(
        'bad_code',
        'This agent code is not valid. Ask your agent for the right code',
        422,
      );
    if (agent.supplies !== 'BOTH' && agent.supplies !== d.courierType) {
      throw new DomainError(
        'invalid_input',
        `This agent does not supply ${d.courierType === 'PICKUP' ? 'pickup' : 'delivery'} staff`,
        422,
      );
    }
    if (await this.prisma.user.findFirst({ where: { phone, role: 'courier' } }))
      throw new DomainError('duplicate', 'This phone number already has an account', 409);
    const u = await this.prisma.user.create({
      data: {
        email: phoneEmail(phone),
        name: d.name,
        phone,
        role: 'courier',
        courierType: d.courierType,
        agentId: agent.id,
        pendingApproval: true,
        isActive: false,
        passwordHash: await hashPassword(d.password),
      },
    });
    await openAlert(this.prisma, {
      kind: 'STAFF_WAITING_APPROVAL',
      entity: 'user',
      entityId: u.id,
      agentId: agent.id,
      message: `${d.name} joined with your code and is waiting for approval`,
    });
    return {
      id: u.id,
      agentName: agent.name,
      message: 'Registered. Your agent will approve your account',
    };
  }

  async staff(agentId: string) {
    return this.prisma.user.findMany({
      where: { agentId, role: 'courier' },
      select: STAFF_SELECT,
      orderBy: [{ pendingApproval: 'desc' }, { name: 'asc' }],
    });
  }

  private async checkStaffInput(agentId: string, d: z.infer<typeof StaffInput>) {
    const agent = await this.prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    if (agent.supplies !== 'BOTH' && agent.supplies !== d.courierType)
      throw new DomainError('invalid_input', 'This agent does not supply that type of staff', 422);
    if (d.hubId) {
      const hub = await this.prisma.hub.findUnique({ where: { id: d.hubId } });
      if (!hub || !hub.active) throw new DomainError('invalid_input', 'Unknown hub', 422);
      // Pickup staff work from a sorting facility, delivery staff from a last mile hub.
      if (d.courierType === 'PICKUP' && !hub.isSorting)
        throw new DomainError('invalid_input', 'Pickup staff work from a sorting facility', 422);
      if (d.courierType === 'DELIVERY' && hub.isSorting)
        throw new DomainError('invalid_input', 'Delivery staff work from a last mile hub', 422);
    }
    if (d.hubToHub && d.courierType !== 'PICKUP')
      throw new DomainError(
        'invalid_input',
        'Only pickup staff can be registered for hub to hub',
        422,
      );
    if (d.vehicleId) {
      const v = await this.prisma.vehicle.findUnique({ where: { id: d.vehicleId } });
      if (!v || v.agentId !== agentId)
        throw new DomainError('invalid_input', 'Pick one of your own vehicles', 422);
      if (d.courierType === 'DELIVERY')
        throw new DomainError(
          'invalid_input',
          'Delivery staff ride their own motorcycle; no agent vehicle',
          422,
        );
    }
    if (d.areaIds.length) {
      const n = await this.prisma.networkArea.count({ where: { id: { in: d.areaIds } } });
      if (n !== d.areaIds.length) throw new DomainError('invalid_input', 'Unknown area', 422);
    }
  }

  async createStaff(agentId: string, body: unknown, user: SessionUser) {
    const d = parse(StaffInput, body);
    if (!d.password)
      throw new DomainError('invalid_input', 'Set a password of 8 characters or more', 422);
    const phone = phoneOrFail(d.phone);
    await this.checkStaffInput(agentId, d);
    if (await this.prisma.user.findFirst({ where: { phone, role: 'courier' } }))
      throw new DomainError('duplicate', 'This phone number already has an account', 409);
    const u = await this.prisma.user.create({
      data: {
        email: phoneEmail(phone),
        name: d.name,
        phone,
        role: 'courier',
        courierType: d.courierType,
        agentId,
        hubId: d.hubId ?? null,
        hubToHub: d.hubToHub,
        shiftStart: d.shiftStart,
        workDays: d.workDays,
        vehicleId: d.vehicleId ?? null,
        isActive: !!d.hubId,
        pendingApproval: !d.hubId,
        passwordHash: await hashPassword(d.password),
        courierAreas: { create: d.areaIds.map((areaId) => ({ areaId })) },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'STAFF_CREATED',
        entityType: 'user',
        entityId: u.id,
        after: { agentId, courierType: d.courierType },
      },
    });
    return { id: u.id };
  }

  async updateStaff(agentId: string, staffId: string, body: unknown, user: SessionUser) {
    const d = parse(StaffInput, body);
    const current = await this.prisma.user.findFirst({
      where: { id: staffId, agentId, role: 'courier' },
    });
    if (!current) throw notFound('Staff member');
    await this.checkStaffInput(agentId, d);
    const phone = phoneOrFail(d.phone);
    const approving = current.pendingApproval && !!d.hubId;
    if (current.pendingApproval && d.active && !d.hubId)
      throw new DomainError('invalid_input', 'Choose a hub before approving', 422);
    await this.prisma.$transaction([
      this.prisma.courierArea.deleteMany({ where: { userId: staffId } }),
      this.prisma.user.update({
        where: { id: staffId },
        data: {
          name: d.name,
          phone,
          courierType: d.courierType,
          hubId: d.hubId ?? null,
          hubToHub: d.hubToHub,
          shiftStart: d.shiftStart,
          workDays: d.workDays,
          vehicleId: d.vehicleId ?? null,
          isActive: approving ? true : (d.active ?? current.isActive),
          pendingApproval: approving ? false : current.pendingApproval,
          ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
          courierAreas: { create: d.areaIds.map((areaId) => ({ areaId })) },
        },
      }),
    ]);
    if (approving)
      await resolveAlerts(
        this.prisma,
        'user',
        staffId,
        ['STAFF_WAITING_APPROVAL'],
        user.id,
        'Approved',
      );
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: approving ? 'STAFF_APPROVED' : 'STAFF_UPDATED',
        entityType: 'user',
        entityId: staffId,
        after: { hubId: d.hubId, active: d.active },
      },
    });
  }

  // ---------------------------------------------------------------- vehicles

  vehicles(agentId: string) {
    return this.prisma.vehicle.findMany({
      where: { agentId },
      include: { users: { select: { id: true, name: true } } },
      orderBy: { plate: 'asc' },
    });
  }

  async saveVehicle(agentId: string, id: string | null, body: unknown, user: SessionUser) {
    const d = parse(VehicleInput, body);
    if (d.contract === 'FIXED' && d.kind !== 'MOTORCYCLE' && d.monthlyRent <= 0)
      throw new DomainError('invalid_input', 'A fixed vehicle needs its monthly rent', 422);
    const clash = await this.prisma.vehicle.findUnique({ where: { plate: d.plate } });
    if (clash && clash.id !== id)
      throw new DomainError('duplicate', `Plate ${d.plate} is already registered`, 409);
    if (id) {
      const v = await this.prisma.vehicle.findFirst({ where: { id, agentId } });
      if (!v) throw notFound('Vehicle');
    }
    const v = id
      ? await this.prisma.vehicle.update({ where: { id }, data: d })
      : await this.prisma.vehicle.create({ data: { ...d, agentId } });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: id ? 'VEHICLE_UPDATED' : 'VEHICLE_CREATED',
        entityType: 'vehicle',
        entityId: v.id,
        after: d,
      },
    });
    return v;
  }

  // ---------------------------------------------------------------- special vehicle requests

  async createVehicleRequest(body: unknown, user: SessionUser) {
    const d = parse(VehicleRequestInput, body);
    const agent = await this.prisma.agent.findUnique({ where: { id: d.agentId } });
    if (!agent || !agent.active)
      throw new DomainError('invalid_input', 'Pick an active agent', 422);
    return this.prisma.tx(async (tx) => {
      const r = await tx.vehicleRequest.create({
        data: {
          ...d,
          merchantId: d.merchantId ?? null,
          hubId: d.hubId ?? null,
          code: await nextCode(tx, 'pickup_seq', 'VR'),
          requestedById: user.id,
        },
      });
      await openAlert(tx, {
        kind: 'VEHICLE_REQUESTED',
        entity: 'vehicle_request',
        entityId: r.id,
        agentId: d.agentId,
        message: `Operations asked for a vehicle with driver on ${d.date} (${r.code})`,
      });
      return r;
    });
  }

  vehicleRequests(filter: { agentId?: string }) {
    return this.prisma.vehicleRequest.findMany({
      where: filter,
      include: {
        vehicle: { select: { plate: true } },
        agent: { select: { name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async provideVehicle(agentId: string, requestId: string, body: unknown, user: SessionUser) {
    const d = parse(ProvideInput, body);
    const phone = phoneOrFail(d.driverPhone, 'Driver phone');
    const r = await this.prisma.vehicleRequest.findFirst({ where: { id: requestId, agentId } });
    if (!r) throw notFound('Request');
    if (r.status !== 'REQUESTED')
      throw new DomainError('bad_status', 'This request was already answered', 409);
    if (
      d.vehicleId &&
      !(await this.prisma.vehicle.findFirst({ where: { id: d.vehicleId, agentId } }))
    )
      throw new DomainError('invalid_input', 'Pick one of your own vehicles', 422);
    await this.prisma.vehicleRequest.update({
      where: { id: requestId },
      data: {
        status: 'PROVIDED',
        vehicleId: d.vehicleId ?? null,
        driverName: d.driverName,
        driverPhone: phone,
        notes: [r.notes, d.notes].filter(Boolean).join(' · '),
        providedAt: new Date(),
      },
    });
    await resolveAlerts(
      this.prisma,
      'vehicle_request',
      requestId,
      undefined,
      user.id,
      'Vehicle provided',
    );
  }

  async closeVehicleRequest(requestId: string, outcome: 'DONE' | 'CANCELLED', user: SessionUser) {
    const r = await this.prisma.vehicleRequest.updateMany({
      where: {
        id: requestId,
        status: { in: outcome === 'DONE' ? ['PROVIDED'] : ['REQUESTED', 'PROVIDED'] },
      },
      data: { status: outcome },
    });
    if (r.count !== 1)
      throw new DomainError('bad_status', 'This request cannot be changed now', 409);
    await resolveAlerts(this.prisma, 'vehicle_request', requestId, undefined, user.id, outcome);
  }

  // ---------------------------------------------------------------- attendance

  /** Makes sure today's shift exists for every active courier who works today. */
  async ensureShifts(at = new Date()) {
    const { date, weekday } = cairoClock(at);
    const couriers = await this.prisma.user.findMany({
      where: {
        role: 'courier',
        isActive: true,
        agentId: { not: null },
        workDays: { has: weekday },
      },
      select: { id: true, agentId: true, shiftStart: true },
    });
    if (couriers.length === 0) return 0;
    const res = await this.prisma.courierShift.createMany({
      data: couriers.map((c) => ({
        courierId: c.id,
        agentId: c.agentId!,
        date,
        startAt: cairoTimeToUtc(date, c.shiftStart),
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  /**
   * Runs every minute. 30 minutes after a shift starts with no check in, the agent is asked
   * whether the person is late or not coming. After "not coming" the agent has 1 hour to send a
   * replacement; missing it raises an alert for operations.
   */
  async attendanceTick(at = new Date()) {
    const settings = await this.settings.all();
    await this.ensureShifts(at);
    const alertAfter = settings['attendance.alert_after_minutes'] * 60000;
    const missing = await this.prisma.courierShift.findMany({
      where: {
        status: 'SCHEDULED',
        checkInAt: null,
        alertedAt: null,
        startAt: { lte: new Date(at.getTime() - alertAfter) },
      },
      include: { courier: { select: { name: true } } },
    });
    for (const s of missing) {
      await this.prisma.courierShift.update({ where: { id: s.id }, data: { alertedAt: at } });
      await openAlert(this.prisma, {
        kind: 'NOT_CHECKED_IN',
        entity: 'shift',
        entityId: s.id,
        agentId: s.agentId,
        message: `${s.courier.name} has not checked in ${settings['attendance.alert_after_minutes']} minutes after the shift started. Late or not coming?`,
      });
    }
    const lateGone = await this.prisma.courierShift.findMany({
      where: {
        status: 'LATE_NOTICE',
        checkInAt: null,
        expectedAt: { lte: new Date(at.getTime() - alertAfter) },
      },
      include: { courier: { select: { name: true } } },
    });
    for (const s of lateGone) {
      await openAlert(this.prisma, {
        kind: 'LATE_STILL_MISSING',
        entity: 'shift',
        entityId: s.id,
        agentId: s.agentId,
        message: `${s.courier.name} said late but has still not checked in`,
      });
    }
    const overdue = await this.prisma.courierShift.findMany({
      where: {
        status: 'NOT_COMING',
        replacementShiftId: null,
        replacementOverdue: false,
        replacementDeadline: { lte: at },
      },
      include: { courier: { select: { name: true } }, agent: { select: { name: true } } },
    });
    for (const s of overdue) {
      await this.prisma.courierShift.update({
        where: { id: s.id },
        data: { replacementOverdue: true },
      });
      await openAlert(this.prisma, {
        kind: 'REPLACEMENT_OVERDUE',
        entity: 'shift',
        entityId: s.id,
        agentId: s.agentId,
        severity: 'high',
        message: `${s.agent.name} did not send a replacement for ${s.courier.name} within ${settings['attendance.replacement_minutes']} minutes`,
      });
    }
    return {
      alerted: missing.length,
      lateStillMissing: lateGone.length,
      replacementOverdue: overdue.length,
    };
  }

  async shifts(filter: { agentId?: string; date?: string }) {
    const date = filter.date ?? todayInCairo();
    const shifts = await this.prisma.courierShift.findMany({
      where: { date, ...(filter.agentId ? { agentId: filter.agentId } : {}) },
      select: {
        id: true,
        date: true,
        startAt: true,
        status: true,
        checkInAt: true,
        lateMinutes: true,
        alertedAt: true,
        answeredAt: true,
        expectedAt: true,
        replacementDeadline: true,
        replacementOverdue: true,
        replacementShiftId: true,
        replacesShiftId: true,
        agentId: true,
        courier: {
          select: {
            id: true,
            name: true,
            phone: true,
            courierType: true,
            hub: { select: { code: true } },
          },
        },
        agent: { select: { name: true } },
      },
      orderBy: [{ startAt: 'asc' }],
    });
    return { date, shifts };
  }

  async answerShift(agentId: string, shiftId: string, body: unknown, user: SessionUser) {
    const d = parse(AnswerInput, body);
    const s = await this.prisma.courierShift.findFirst({ where: { id: shiftId, agentId } });
    if (!s) throw notFound('Shift');
    if (s.checkInAt) throw new DomainError('bad_status', 'This person already checked in', 409);
    if (!['SCHEDULED', 'LATE_NOTICE'].includes(s.status))
      throw new DomainError('bad_status', 'This shift was already answered', 409);
    const now = new Date();
    if (d.answer === 'LATE') {
      const expectedAt = cairoTimeToUtc(s.date, d.expectedTime);
      await this.prisma.courierShift.update({
        where: { id: shiftId },
        data: { status: 'LATE_NOTICE', answeredAt: now, expectedAt },
      });
      await resolveAlerts(
        this.prisma,
        'shift',
        shiftId,
        ['NOT_CHECKED_IN'],
        user.id,
        `Late, expected ${d.expectedTime}`,
      );
      return { status: 'LATE_NOTICE' };
    }
    const minutes = (await this.settings.all())['attendance.replacement_minutes'];
    const replacementDeadline = new Date(now.getTime() + minutes * 60000);
    await this.prisma.courierShift.update({
      where: { id: shiftId },
      data: { status: 'NOT_COMING', answeredAt: now, replacementDeadline },
    });
    await resolveAlerts(
      this.prisma,
      'shift',
      shiftId,
      ['NOT_CHECKED_IN', 'LATE_STILL_MISSING'],
      user.id,
      'Not coming',
    );
    await openAlert(this.prisma, {
      kind: 'REPLACEMENT_NEEDED',
      entity: 'shift',
      entityId: shiftId,
      agentId,
      message: `Send a replacement within ${minutes} minutes`,
    });
    return { status: 'NOT_COMING', replacementDeadline };
  }

  async assignReplacement(agentId: string, shiftId: string, body: unknown, user: SessionUser) {
    const { courierId } = parse(ReplacementInput, body);
    return this.prisma.tx(async (tx) => {
      const s = await tx.courierShift.findFirst({
        where: { id: shiftId, agentId },
        include: { courier: true },
      });
      if (!s) throw notFound('Shift');
      if (s.status !== 'NOT_COMING')
        throw new DomainError('bad_status', 'Say the person is not coming first', 409);
      if (s.replacementShiftId)
        throw new DomainError('bad_status', 'A replacement is already assigned', 409);
      const r = await tx.user.findFirst({
        where: { id: courierId, agentId, role: 'courier', isActive: true },
      });
      if (!r) throw new DomainError('invalid_input', 'Pick one of your active staff', 422);
      if (r.id === s.courierId) throw new DomainError('invalid_input', 'Pick someone else', 422);
      if (r.courierType !== s.courier.courierType)
        throw new DomainError(
          'invalid_input',
          `Pick ${s.courier.courierType === 'PICKUP' ? 'pickup' : 'delivery'} staff`,
          422,
        );
      const own = await tx.courierShift.findUnique({
        where: { courierId_date: { courierId, date: s.date } },
      });
      if (own && own.status !== 'NOT_COMING' && !own.replacesShiftId) {
        // They were already working today: they cannot cover a second shift at the same time.
        if (own.checkInAt || own.status === 'SCHEDULED' || own.status === 'LATE_NOTICE')
          throw new DomainError(
            'invalid_input',
            `${r.name} already has their own shift today`,
            422,
          );
      }
      const cover = own
        ? await tx.courierShift.update({ where: { id: own.id }, data: { replacesShiftId: s.id } })
        : await tx.courierShift.create({
            data: { courierId, agentId, date: s.date, startAt: new Date(), replacesShiftId: s.id },
          });
      // The replacement works the absent person's hub for the day.
      if (s.courier.hubId && r.hubId !== s.courier.hubId)
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'REPLACEMENT_OTHER_HUB',
            entityType: 'user',
            entityId: courierId,
            after: { from: r.hubId, to: s.courier.hubId },
          },
        });
      await tx.courierShift.update({
        where: { id: s.id },
        data: { status: 'REPLACED', replacementShiftId: cover.id },
      });
      await resolveAlerts(
        tx,
        'shift',
        s.id,
        ['REPLACEMENT_NEEDED', 'REPLACEMENT_OVERDUE'],
        user.id,
        `Replaced by ${r.name}`,
      );
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'REPLACEMENT_ASSIGNED',
          entityType: 'shift',
          entityId: s.id,
          after: {
            courierId,
            late: s.replacementDeadline ? new Date() > s.replacementDeadline : false,
          },
        },
      });
      return {
        replacementShiftId: cover.id,
        onTime: !s.replacementDeadline || new Date() <= s.replacementDeadline,
      };
    });
  }

  // ---------------------------------------------------------------- courier

  async myShift(user: SessionUser) {
    const date = todayInCairo();
    const s = await this.prisma.courierShift.findUnique({
      where: { courierId_date: { courierId: user.id, date } },
      select: {
        id: true,
        date: true,
        startAt: true,
        status: true,
        checkInAt: true,
        lateMinutes: true,
        replacesShiftId: true,
      },
    });
    return { date, linked: !!user.agentId, shift: s };
  }

  /** Check in with a photo (kept only, not used for identity checks yet). */
  async checkIn(user: SessionUser, body: unknown): Promise<CourierShift> {
    const d = parse(CheckInInput, body);
    const photo = decode(d.photoBase64, MAX_PHOTO_BYTES, 'The photo');
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!me.agentId)
      throw new DomainError('forbidden', 'Your account is not linked to an agent', 403);
    const now = new Date();
    const date = todayInCairo(now);
    const existing = await this.prisma.courierShift.findUnique({
      where: { courierId_date: { courierId: user.id, date } },
    });
    if (existing?.checkInAt)
      throw new DomainError('bad_status', 'You already checked in today', 409);
    if (existing && (existing.status === 'NOT_COMING' || existing.status === 'REPLACED'))
      throw new DomainError(
        'bad_status',
        'Your agent reported you as not coming today. Call your agent',
        409,
      );
    const startAt = existing?.startAt ?? cairoTimeToUtc(date, me.shiftStart);
    const lateMinutes = Math.max(0, Math.round((now.getTime() - startAt.getTime()) / 60000));
    const data = {
      status: 'CHECKED_IN' as const,
      checkInAt: now,
      checkInPhoto: photo,
      checkInLat: d.lat ?? null,
      checkInLng: d.lng ?? null,
      lateMinutes,
    };
    const shift = existing
      ? await this.prisma.courierShift.update({ where: { id: existing.id }, data })
      : await this.prisma.courierShift.create({
          data: { ...data, courierId: user.id, agentId: me.agentId, date, startAt },
        });
    await resolveAlerts(
      this.prisma,
      'shift',
      shift.id,
      ['NOT_CHECKED_IN', 'LATE_STILL_MISSING'],
      user.id,
      'Checked in',
    );
    return shift;
  }

  async checkInPhoto(shiftId: string) {
    const s = await this.prisma.courierShift.findUnique({
      where: { id: shiftId },
      select: { checkInPhoto: true, agentId: true },
    });
    if (!s?.checkInPhoto) throw notFound('Photo');
    return s;
  }

  // ---------------------------------------------------------------- alerts

  /** Alerts with the names the screens need to word them in either language. */
  async alerts(filter: { agentId?: string; status?: 'OPEN' | 'RESOLVED' }) {
    const rows = await this.prisma.networkAlert.findMany({
      where: {
        status: filter.status ?? 'OPEN',
        ...(filter.agentId ? { agentId: filter.agentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const ids = (entity: string) => rows.filter((r) => r.entity === entity).map((r) => r.entityId);
    const [agents, shifts, users, requests] = await Promise.all([
      this.prisma.agent.findMany({
        where: { id: { in: rows.map((r) => r.agentId).filter((x): x is string => !!x) } },
        select: { id: true, name: true },
      }),
      this.prisma.courierShift.findMany({
        where: { id: { in: ids('shift') } },
        select: {
          id: true,
          expectedAt: true,
          replacementDeadline: true,
          courier: { select: { name: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids('user') } },
        select: { id: true, name: true },
      }),
      this.prisma.vehicleRequest.findMany({
        where: { id: { in: ids('vehicle_request') } },
        select: { id: true, code: true, date: true },
      }),
    ]);
    return rows.map((r) => {
      const shift = shifts.find((x) => x.id === r.entityId);
      const request = requests.find((x) => x.id === r.entityId);
      return {
        ...r,
        agentName: agents.find((a) => a.id === r.agentId)?.name ?? null,
        subject:
          shift?.courier.name ??
          users.find((x) => x.id === r.entityId)?.name ??
          request?.code ??
          null,
        date: request?.date ?? null,
        deadline: shift?.replacementDeadline ?? null,
      };
    });
  }

  async resolveAlert(id: string, note: string, user: SessionUser, agentId?: string) {
    const r = await this.prisma.networkAlert.updateMany({
      where: { id, status: 'OPEN', ...(agentId ? { agentId } : {}) },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: user.id,
        note: note.slice(0, 300),
      },
    });
    if (r.count !== 1) throw notFound('Open alert');
  }

  async overview(agentId: string) {
    const date = todayInCairo();
    const agent = await this.prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    const [staff, vehicles, shifts, alerts, requests] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['courierType', 'pendingApproval', 'isActive'],
        where: { agentId, role: 'courier' },
        _count: true,
      }),
      this.prisma.vehicle.count({ where: { agentId, active: true } }),
      this.prisma.courierShift.groupBy({ by: ['status'], where: { agentId, date }, _count: true }),
      this.prisma.networkAlert.count({ where: { agentId, status: 'OPEN' } }),
      this.prisma.vehicleRequest.count({ where: { agentId, status: 'REQUESTED' } }),
    ]);
    const defaultBp = (await this.settings.all())['agents.default_commission_bp'];
    const count = (pred: (s: (typeof staff)[number]) => boolean) =>
      staff.filter(pred).reduce((n, s) => n + (s._count as number), 0);
    return {
      agent: {
        id: agent.id,
        code: agent.code,
        name: agent.name,
        supplies: agent.supplies,
        commissionBp: agent.commissionBp ?? defaultBp,
      },
      date,
      pickupStaff: count((s) => s.courierType === 'PICKUP' && s.isActive),
      deliveryStaff: count((s) => s.courierType === 'DELIVERY' && s.isActive),
      pending: count((s) => s.pendingApproval),
      vehicles,
      shifts: Object.fromEntries(shifts.map((s) => [s.status, s._count])),
      openAlerts: alerts,
      openRequests: requests,
    };
  }
}
