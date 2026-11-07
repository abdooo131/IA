import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  addRecordNote,
  completeRecordActivity,
  DomainError,
  listRecordActivities,
  listRecordNotes,
  myActivities,
  recordAudit,
  recordRef,
  scheduleActivity,
  teamWith,
} from '@shiplynow/db';
import {
  type AccessLevel,
  type AccessProfile,
  type AccessTokenClaims,
  cairoDay,
  canDo,
  listColumnsSchema,
  listFavoriteSchema,
  RECORD_APPS,
  recordActivitySchema,
  recordNoteSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertMerchant, assertStore } from '../auth/access-scope';
import { Access, ANY_APP, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const LIST_KEY = /^[a-z0-9_]{1,40}$/;

/**
 * The chatter on a document page (notes, scheduled activities) and the per person list view
 * settings (saved favourites, chosen columns). Reading a record's chatter needs view on the
 * record's app (RECORD_APPS, the same rule as its history) and its store and merchant in the
 * person's scope; writing needs use.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Access(ANY_APP)
@Controller()
export class RecordsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private async allowed(
    access: AccessProfile,
    entityType: string,
    entityId: string,
    level: AccessLevel,
  ) {
    const apps = RECORD_APPS[entityType] ?? [];
    if (!apps.some((app) => canDo(access, app, level)))
      throw new ForbiddenException({ error: 'no_access' });
    const ref = await recordRef(this.prisma, entityType, entityId);
    if (!ref) throw new NotFoundException({ error: 'not_found' });
    if (ref.darkStoreId) assertStore(access, ref.darkStoreId);
    if (ref.merchantId) assertMerchant(access, ref.merchantId);
    return ref;
  }

  @Get('records/:entityType/:entityId/notes')
  async notes(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.allowed(access, entityType, entityId, 'view');
    return listRecordNotes(this.prisma, entityType, entityId);
  }

  @Post('records/:entityType/:entityId/notes')
  async addNote(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body(new ZodValidationPipe(recordNoteSchema)) body: z.infer<typeof recordNoteSchema>,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.allowed(access, entityType, entityId, 'use');
    return addRecordNote(this.prisma, {
      entityType,
      entityId,
      body: body.body,
      actorUserId: user.sub,
    });
  }

  @Get('records/:entityType/:entityId/activities')
  async activities(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.allowed(access, entityType, entityId, 'view');
    return listRecordActivities(this.prisma, entityType, entityId);
  }

  /** The people who can be reminded about a record: active team members with view on its app. */
  @Get('records/:entityType/:entityId/people')
  async people(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentAccess() access: AccessProfile,
  ) {
    const ref = await this.allowed(access, entityType, entityId, 'view');
    const app = (RECORD_APPS[entityType] ?? [])[0];
    if (!app) return [];
    const ids = await teamWith(this.prisma, app, 'view', {
      storeId: ref.darkStoreId,
      merchantId: ref.merchantId,
    });
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post('records/:entityType/:entityId/activities')
  async schedule(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body(new ZodValidationPipe(recordActivitySchema)) body: z.infer<typeof recordActivitySchema>,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const ref = await this.allowed(access, entityType, entityId, 'use');
    if (body.dueOn < cairoDay(this.clock.now())) throw new DomainError('due_in_past', 400);
    if (body.assigneeId && body.assigneeId !== user.sub) {
      // Only someone who may open the record can be reminded about it.
      const app = (RECORD_APPS[entityType] ?? [])[0];
      const may = app
        ? await teamWith(this.prisma, app, 'view', {
            storeId: ref.darkStoreId,
            merchantId: ref.merchantId,
          })
        : [];
      if (!may.includes(body.assigneeId)) throw new DomainError('assignee_not_allowed', 400);
    }
    return scheduleActivity(this.prisma, {
      entityType,
      entityId,
      ref,
      dueOn: body.dueOn,
      note: body.note,
      assigneeId: body.assigneeId,
      actorUserId: user.sub,
    });
  }

  @Post('records/activities/:id/done')
  done(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return completeRecordActivity(this.prisma, { activityId: id, actorUserId: user.sub });
  }

  /** My open reminders (due=1: only those due by today, Cairo). */
  @Get('me/activities')
  mine(@Query('due') due: string | undefined, @CurrentUser() user: AccessTokenClaims) {
    return myActivities(this.prisma, user.sub, {
      dueBy: due === '1' ? cairoDay(this.clock.now()) : undefined,
    });
  }

  // ─── list views: favourites and columns ───

  @Get('me/list-favorites')
  favorites(@Query('list') list: string | undefined, @CurrentUser() user: AccessTokenClaims) {
    if (!list || !LIST_KEY.test(list)) return [];
    return this.prisma.userListFavorite.findMany({
      where: { userId: user.sub, listKey: list },
      select: { id: true, name: true, query: true, isDefault: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Saves the current view under a name (the same name replaces it); one default per list. */
  @Post('me/list-favorites')
  async saveFavorite(
    @Body(new ZodValidationPipe(listFavoriteSchema)) body: z.infer<typeof listFavoriteSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (body.isDefault)
        await tx.userListFavorite.updateMany({
          where: { userId: user.sub, listKey: body.listKey },
          data: { isDefault: false },
        });
      const row = await tx.userListFavorite.upsert({
        where: {
          userId_listKey_name: { userId: user.sub, listKey: body.listKey, name: body.name },
        },
        create: { userId: user.sub, ...body },
        update: { query: body.query, isDefault: body.isDefault },
        select: { id: true, name: true, query: true, isDefault: true },
      });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'list.favorite_save',
        entityType: 'user',
        entityId: user.sub,
        after: { list: body.listKey, name: body.name, isDefault: body.isDefault },
      });
      return row;
    });
  }

  @Delete('me/list-favorites/:id')
  async deleteFavorite(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const deleted = await this.prisma.userListFavorite.deleteMany({
      where: { id, userId: user.sub },
    });
    if (deleted.count === 0) throw new NotFoundException({ error: 'not_found' });
    return { deleted: true };
  }

  @Get('me/list-prefs/:list')
  async prefs(@Param('list') list: string, @CurrentUser() user: AccessTokenClaims) {
    if (!LIST_KEY.test(list)) throw new NotFoundException({ error: 'not_found' });
    const row = await this.prisma.userListPrefs.findUnique({
      where: { userId_listKey: { userId: user.sub, listKey: list } },
    });
    return { columns: row?.columns ?? null };
  }

  @Put('me/list-prefs/:list')
  async setPrefs(
    @Param('list') list: string,
    @Body(new ZodValidationPipe(listColumnsSchema)) body: z.infer<typeof listColumnsSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (!LIST_KEY.test(list)) throw new NotFoundException({ error: 'not_found' });
    await this.prisma.userListPrefs.upsert({
      where: { userId_listKey: { userId: user.sub, listKey: list } },
      create: { userId: user.sub, listKey: list, columns: body.columns },
      update: { columns: body.columns },
    });
    return { columns: body.columns };
  }
}
