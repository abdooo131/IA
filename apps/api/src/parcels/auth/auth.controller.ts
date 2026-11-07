import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, Roles, type SessionUser } from './auth';

/** Sign in and out are Shiply Now's (/auth/login, /auth/logout); the network adds who you are in it. */
@Controller('auth')
@Roles()
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    const [hub, merchant, agent] = await Promise.all([
      user.hubId ? this.prisma.hub.findUnique({ where: { id: user.hubId } }) : null,
      user.merchantId ? this.prisma.merchant.findUnique({ where: { id: user.merchantId } }) : null,
      user.agentId ? this.prisma.agent.findUnique({ where: { id: user.agentId } }) : null,
    ]);
    return {
      ...user,
      hub: hub && { id: hub.id, code: hub.code, name: hub.name, isSorting: hub.isSorting },
      merchant: merchant && { id: merchant.id, code: merchant.code, name: merchant.name },
      agent: agent && { id: agent.id, code: agent.code, name: agent.name },
    };
  }
}
