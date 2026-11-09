import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Tx } from '@shiply/db';
import { onEvent } from '../platform';

/**
 * The work an agent's people did, learnt from the other modules' events: what settlements count.
 * Each entry is keyed by its source, so an event delivered twice counts once.
 */
@Injectable()
export class WorkLogService implements OnModuleInit {
  private async log(tx: Tx, e: { sourceKey: string; agentId: string; personUserId?: string | null; kind: string; companyKey: string }) {
    await tx.workLog.createMany({ data: [{ ...e, personUserId: e.personUserId ?? null, at: new Date() }], skipDuplicates: true });
  }

  private async byPerson(tx: Tx, userId: string | undefined, sourceKey: string, kind: string, companyKey: string) {
    if (!userId) return;
    const p = await tx.person.findUnique({ where: { userId } });
    if (p) await this.log(tx, { sourceKey, agentId: p.agentId, personUserId: userId, kind, companyKey });
  }

  onModuleInit() {
    onEvent('parcel.status_changed', 'agents.delivery', async (payload, tx) => {
      const p = payload as { parcelId: string; to: string; courierId?: string };
      if (p.to === 'delivered') await this.byPerson(tx, p.courierId, `delivery:${p.parcelId}`, 'delivery', 'shiply');
    });
    onEvent('pickup.started', 'agents.pickup', async (payload, tx) => {
      const p = payload as { pickupId: string; courierId: string };
      await this.byPerson(tx, p.courierId, `pickup:${p.pickupId}`, 'pickup', 'shiply');
    });
    onEvent('car.departed', 'agents.trip', async (payload, tx) => {
      const p = payload as { carId: string; routeId?: string | null };
      if (!p.routeId) return;
      const route = await tx.truckRoute.findUnique({ where: { id: p.routeId } });
      if (route) await this.log(tx, { sourceKey: `trip:${p.carId}`, agentId: route.agentId, kind: 'trip', companyKey: 'shiply' });
    });
  }
}
