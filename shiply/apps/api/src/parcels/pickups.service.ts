import { HttpException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { DB, publish } from '../platform';
import { ParcelsService } from './parcels.service';
import { registerStep } from './scan.service';

@Injectable()
export class PickupsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(ParcelsService) private readonly parcels: ParcelsService,
  ) {}

  onModuleInit() {
    // The courier at the merchant scans each parcel he takes.
    registerStep('pickup', {
      site: false,
      handler: async (tx, { input, user, parcel }) => {
        const pickup = input.pickupId ? await tx.pickup.findUnique({ where: { id: input.pickupId } }) : null;
        if (!pickup || pickup.courierId !== user.id) throw new HttpException({ error: 'not_your_pickup' }, 403);
        if (!['assigned', 'on_the_way'].includes(pickup.status)) throw new HttpException({ error: 'wrong_status' }, 409);
        if (parcel!.merchantId !== pickup.merchantId) throw new HttpException({ error: 'other_merchant' }, 409);
        await this.parcels.move(tx, parcel!.id, 'picked_up', { userId: user.id, set: { pickupId: pickup.id } });
        if (pickup.status === 'assigned') {
          await tx.pickup.update({ where: { id: pickup.id }, data: { status: 'on_the_way' } });
          await publish(tx, 'pickup.started', { pickupId: pickup.id, courierId: user.id, merchantId: pickup.merchantId }, `pickup.started:${pickup.id}`);
        }
        const count = await tx.parcel.count({ where: { pickupId: pickup.id } });
        return { ok: true, colour: 'green', big: String(count), small: parcel!.tracking, parcelId: parcel!.id };
      },
    });
  }

  /** Makes the day's pickups from the recurring ones; running it again adds nothing. */
  async makeDay(date: Date, userId: string) {
    const rec = await this.db.recurringPickup.findMany({ where: { active: true, weekdays: { has: date.getUTCDay() } } });
    const { count } = await this.db.pickup.createMany({
      data: rec.map((r) => ({ merchantId: r.merchantId, date, recurringId: r.id, createdById: userId })),
      skipDuplicates: true,
    });
    return { created: count };
  }
}
