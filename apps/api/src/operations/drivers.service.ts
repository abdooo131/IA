import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DriverStatus, DriverType, Prisma } from '@prisma/client';
import { normalizeEgyptianPhone } from '@shiply/shared';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ACC } from '../accounting/posting';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { PrismaService } from '../prisma/prisma.service';

export interface DriverInput {
  type: DriverType;
  fullName: string;
  phone: string;
  email?: string | null;
  nationalId?: string | null;
  vehicle?: string;
  hubId?: string | null;
  /** Only the seed sets this (demo password); real drivers get a random one until the driver apps exist. */
  password?: string;
}

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Drivers with live workload and the cash each one is holding (from the ledger). */
  async list(ctx: RequestContext, q: { type?: DriverType; hubId?: string; status?: DriverStatus }) {
    return this.prisma.withContext(ctx, async (tx) => {
      const drivers = await tx.driver.findMany({
        where: { type: q.type, hubId: q.hubId || undefined, status: q.status ?? { not: 'ARCHIVED' } },
        include: { hub: { select: { code: true, nameEn: true, nameAr: true } } },
        orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      });
      const ids = drivers.map((d) => d.id);
      const [pickups, deliveries, cash, shortages] = await Promise.all([
        tx.order.groupBy({ by: ['pickupDriverId'], where: { pickupDriverId: { in: ids }, status: 'PENDING_PICKUP' }, _count: true }),
        tx.order.groupBy({ by: ['deliveryDriverId'], where: { deliveryDriverId: { in: ids }, status: { in: ['ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER'] } }, _count: true }),
        tx.ledgerEntry.groupBy({ by: ['driverId'], where: { driverId: { in: ids }, accountCode: ACC.CASH_WITH_DRIVERS }, _sum: { debit: true, credit: true } }),
        tx.ledgerEntry.groupBy({ by: ['driverId'], where: { driverId: { in: ids }, accountCode: ACC.DRIVER_SHORTAGES }, _sum: { debit: true, credit: true } }),
      ]);
      return drivers.map((d) => {
        const c = cash.find((x) => x.driverId === d.id);
        const s = shortages.find((x) => x.driverId === d.id);
        return {
          ...d,
          openPickups: pickups.find((x) => x.pickupDriverId === d.id)?._count ?? 0,
          openDeliveries: deliveries.find((x) => x.deliveryDriverId === d.id)?._count ?? 0,
          cashHeld: (c?._sum.debit ?? 0) - (c?._sum.credit ?? 0),
          shortageOwed: (s?._sum.debit ?? 0) - (s?._sum.credit ?? 0),
        };
      });
    });
  }

  /** Creates the driver profile and its login (used by the driver apps later). */
  async create(ctx: RequestContext, input: DriverInput) {
    const phone = normalizeEgyptianPhone(input.phone);
    if (!phone) throw new BadRequestException('Invalid Egyptian mobile number');
    return this.prisma.withContext(ctx, async (tx) => {
      const email = (input.email?.trim().toLowerCase() || `driver.${phone.slice(3)}@drivers.shiply.eg`);
      if (await tx.user.findUnique({ where: { email } })) throw new ConflictException(`A user with ${email} already exists`);
      const user = await tx.user.create({
        data: {
          email,
          phone,
          fullName: input.fullName,
          role: input.type === 'PICKUP' ? 'PICKUP_DRIVER' : 'DELIVERY_DRIVER',
          passwordHash: await bcrypt.hash(input.password ?? randomBytes(12).toString('base64url'), 10),
          hubId: input.hubId ?? null,
        },
      });
      const driver = await tx.driver.create({
        data: {
          userId: user.id,
          type: input.type,
          fullName: input.fullName,
          phone,
          nationalId: input.nationalId ?? null,
          vehicle: input.vehicle ?? 'MOTORCYCLE',
          hubId: input.hubId ?? null,
        },
      });
      await this.audit.record(tx, ctx, { action: 'driver.create', entityType: 'driver', entityId: driver.id, after: driver });
      return driver;
    });
  }

  async update(ctx: RequestContext, id: string, input: Partial<DriverInput> & { status?: DriverStatus }) {
    return this.prisma.withContext(ctx, async (tx) => {
      const before = await tx.driver.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Driver not found');
      const data: Prisma.DriverUpdateInput = {};
      if (input.fullName) data.fullName = input.fullName;
      if (input.phone) {
        const phone = normalizeEgyptianPhone(input.phone);
        if (!phone) throw new BadRequestException('Invalid Egyptian mobile number');
        data.phone = phone;
      }
      if (input.vehicle) data.vehicle = input.vehicle;
      if (input.hubId !== undefined) data.hub = input.hubId ? { connect: { id: input.hubId } } : { disconnect: true };
      if (input.status) data.status = input.status;
      const after = await tx.driver.update({ where: { id }, data });
      if (input.status && input.status !== 'ACTIVE') await tx.user.update({ where: { id: before.userId }, data: { archived: input.status === 'ARCHIVED' } });
      await this.audit.record(tx, ctx, { action: 'driver.update', entityType: 'driver', entityId: id, before, after });
      return after;
    });
  }

  async requireActive(tx: Prisma.TransactionClient, id: string, type: DriverType) {
    const d = await tx.driver.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Driver not found');
    if (d.type !== type) throw new ConflictException(`${d.fullName} is a ${d.type.toLowerCase()} driver`);
    if (d.status !== 'ACTIVE') throw new ConflictException(`${d.fullName} is ${d.status.toLowerCase()}`);
    return d;
  }
}
