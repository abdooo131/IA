import { HttpException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { MerchantsService } from '../merchants';
import { CashService } from '../money';
import { loginsInfo, publish } from '../platform';
import { ParcelsService } from './parcels.service';
import { registerStep } from './scan.service';

export const FAIL_REASONS = ['no_answer', 'refused', 'wrong_address', 'rescheduled', 'closed', 'other'] as const;

/** What the courier does at the door, and handing returns back to the merchant. */
@Injectable()
export class CourierService implements OnModuleInit {
  constructor(
    @Inject(ParcelsService) private readonly parcels: ParcelsService,
    @Inject(MerchantsService) private readonly merchants: MerchantsService,
    @Inject(CashService) private readonly cash: CashService,
  ) {}

  onModuleInit() {
    registerStep('deliver', {
      site: false,
      handler: async (tx, { input, user, parcel: p }) => {
        if (p!.courierId !== user.id || p!.status !== 'out_for_delivery') throw new HttpException({ error: 'wrong_status' }, 409);
        if (input.cash !== p!.codAmount) throw new HttpException({ error: 'wrong_cash' }, 400);
        const number = p!.attempts + 1;
        await tx.attempt.create({ data: { parcelId: p!.id, runId: p!.runId!, number, result: 'delivered', cashCollected: p!.codAmount, proof: input.proof ?? 'none' } });
        await this.parcels.move(tx, p!.id, 'delivered', { userId: user.id, set: { attempts: number } });
        const terms = await this.merchants.parcelTerms(p!.merchantId);
        const base = { companyKey: 'shiply', merchantId: p!.merchantId, sourceType: 'parcel', sourceId: p!.id };
        if (p!.codAmount > 0) {
          const [me] = await loginsInfo(tx, [user.id]);
          const holder = await this.cash.holderFor(tx, { kind: 'courier', refId: user.id, nameEn: me?.name ?? 'Courier', nameAr: me?.nameAr ?? 'مندوب', companyKey: 'shiply' });
          await publish(tx, 'cash.collected', { ...base, holderId: holder.id, amount: p!.codAmount }, `parcel.cash:${p!.id}`);
        }
        const fees: [string, number][] = [
          ['delivery', p!.price ?? 0],
          ['cod', Math.round((p!.codAmount * (terms?.codFeeBp ?? 0)) / 10_000)],
          ['open_package', p!.openPackage ? (terms?.openPackageFee ?? 0) : 0],
        ];
        for (const [kind, amount] of fees) if (amount > 0) await publish(tx, 'fee.charged', { ...base, kind, amount }, `parcel.fee:${kind}:${p!.id}`);
        return { ok: true, colour: 'green', big: 'delivered', small: p!.tracking, parcelId: p!.id };
      },
    });

    registerStep('fail', {
      site: false,
      handler: async (tx, { input, user, parcel: p }) => {
        if (p!.courierId !== user.id || p!.status !== 'out_for_delivery') throw new HttpException({ error: 'wrong_status' }, 409);
        if (!(FAIL_REASONS as readonly string[]).includes(input.reason ?? '')) throw new HttpException({ error: 'reason_required' }, 400);
        const number = p!.attempts + 1;
        await tx.attempt.create({ data: { parcelId: p!.id, runId: p!.runId!, number, result: 'failed', reason: input.reason! } });
        await this.parcels.move(tx, p!.id, 'attempt_failed', { userId: user.id, note: input.reason, set: { attempts: number } });
        const allowed = (await this.merchants.parcelTerms(p!.merchantId))?.deliveryAttempts ?? 3;
        if (number >= allowed) {
          await this.parcels.move(tx, p!.id, 'on_hold', { userId: user.id, note: 'attempts used: back to the merchant', set: { direction: 'return' } });
          return { ok: true, colour: 'amber', big: 'return', small: p!.tracking, reason: 'return_to_merchant', parcelId: p!.id };
        }
        return { ok: true, colour: 'amber', big: `${number}/${allowed}`, small: p!.tracking, parcelId: p!.id };
      },
    });

    // A return handed back to the merchant (by the courier who does its pickups).
    registerStep('return_handover', {
      site: false,
      handler: async (tx, { user, parcel: p }) => {
        if (p!.direction !== 'return' || p!.status !== 'at_inbound') throw new HttpException({ error: 'wrong_status' }, 409);
        await this.parcels.move(tx, p!.id, 'returned', { userId: user.id });
        const terms = await this.merchants.parcelTerms(p!.merchantId);
        const fee = Math.round(((p!.price ?? 0) * (terms?.returnFeeBp ?? 0)) / 10_000);
        if (fee > 0) await publish(tx, 'fee.charged', { companyKey: 'shiply', merchantId: p!.merchantId, kind: 'return', amount: fee, sourceType: 'parcel', sourceId: p!.id }, `parcel.fee:return:${p!.id}`);
        return { ok: true, colour: 'green', big: 'returned', small: p!.tracking, parcelId: p!.id };
      },
    });
  }
}
