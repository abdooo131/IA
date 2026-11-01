import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthedRequest, FINANCE_LEVEL_KEY, type FinanceLevelName } from './decorators';

const RANK: Record<FinanceLevelName, number> = { view: 0, prepare: 1, approve: 2 };

/**
 * Finance users have a level: view (reports only), prepare (record movements, prepare
 * payouts) or approve (also approve large amounts and close months). Under /finance every
 * change needs at least prepare; routes marked @FinanceLevel('approve') need approve.
 * Admins pass every level. The level is read fresh, so a change applies at once.
 */
@Injectable()
export class FinanceLevelGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user?.role !== 'finance') return true;
    const marked = this.reflector.getAllAndOverride<FinanceLevelName | undefined>(
      FINANCE_LEVEL_KEY,
      [context.getHandler(), context.getClass()],
    );
    const changes = req.method !== 'GET' && req.method !== 'HEAD';
    const needed: FinanceLevelName | null =
      marked ?? (changes && req.path.startsWith('/finance') ? 'prepare' : null);
    if (!needed || needed === 'view') return true;
    const me = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { financeLevel: true },
    });
    if (!me || RANK[me.financeLevel] < RANK[needed])
      throw new ForbiddenException({ error: 'finance_level_too_low' });
    return true;
  }
}
