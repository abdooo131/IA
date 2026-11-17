import { Injectable, NotFoundException } from '@nestjs/common';
import type { AccessProfile, AccessTokenClaims } from '@shiplynow/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StoreAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the store. Whether the person may work in it was already checked by the
   * AccessGuard on the :storeId parameter (their access profile's stores, docs/ACCESS.md).
   */
  async check(_user: AccessTokenClaims, darkStoreId: string) {
    const store = await this.prisma.darkStore.findUnique({ where: { id: darkStoreId } });
    if (!store) throw new NotFoundException({ error: 'dark_store_not_found' });
    return store;
  }

  /** The stores this person may open: every active one, or their listed stores. */
  storesFor(access: AccessProfile) {
    return this.prisma.darkStore.findMany({
      where: { isActive: true, ...(!access.allStores && { id: { in: access.storeIds } }) },
      orderBy: { code: 'asc' },
    });
  }
}
