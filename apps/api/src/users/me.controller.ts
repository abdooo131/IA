import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getMerchantAccess } from '@shiplynow/db';
import { isTeamRole, type MyAccess } from '@shiplynow/shared';
import { loadAccess } from '../auth/access.guard';
import type { AuthedRequest } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** What the signed in person may open: the web app builds its menus from it. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Open to any signed in user (listed in test/route-access.test.ts). */
  @Get('access')
  async access(@Req() req: AuthedRequest): Promise<MyAccess> {
    const user = req.user!;
    if (isTeamRole(user.role))
      return { kind: 'team', role: user.role, profile: await loadAccess(req, this.prisma) };
    if (user.role === 'merchant') {
      const me = await getMerchantAccess(this.prisma, user.sub);
      if (!me) throw new ForbiddenException({ error: 'forbidden' });
      return { kind: 'merchant', merchantRole: me.merchantRole, rights: me.rights };
    }
    return { kind: 'rider' };
  }
}
