import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StoreAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admins can work in any store; store staff only in their own. Returns the store. */
  async check(user: AccessTokenClaims, darkStoreId: string) {
    const store = await this.prisma.darkStore.findUnique({ where: { id: darkStoreId } });
    if (!store) throw new NotFoundException({ error: 'dark_store_not_found' });
    if (user.role === 'admin') return store;
    const me = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!me || me.darkStoreId !== darkStoreId) throw new ForbiddenException({ error: 'forbidden' });
    return store;
  }

  /** The stores this user may open. */
  async storesFor(user: AccessTokenClaims) {
    if (user.role === 'admin') {
      return this.prisma.darkStore.findMany({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
    }
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { darkStore: true },
    });
    return me?.darkStore ? [me.darkStore] : [];
  }
}
