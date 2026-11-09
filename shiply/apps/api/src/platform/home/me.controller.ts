import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@shiply/db';
import { TILES } from '@shiply/shared';
import { DB } from '../tokens';
import { HomeRegistry } from './home.registry';

@Controller('me')
export class MeController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(HomeRegistry) private readonly home: HomeRegistry,
  ) {}

  @Get()
  async me(@Req() req: Request) {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, nameAr: true, kind: true } });
    return { ...u, access: req.user!.access };
  }

  @Get('home')
  async homePage(@Req() req: Request) {
    const user = req.user!;
    const apps = TILES.filter((t) => user.access[t] !== 'none');
    return {
      attention: await this.home.attentionFor(user),
      numbers: await this.home.numbersFor(user),
      tiles: await Promise.all(apps.map(async (app) => ({ app, count: await this.home.countFor(app, user) }))),
    };
  }
}
