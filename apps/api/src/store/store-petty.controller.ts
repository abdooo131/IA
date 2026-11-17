import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  claimRecordPhoto,
  linkAttachments,
  listCostTags,
  storePettyCash,
  submitPettyCash,
} from '@shiplynow/db';
import { type AccessTokenClaims, pettyCashLabel, pettyCashSchema } from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

/**
 * Petty cash: store staff pay a small expense from the store's cash box with a receipt photo
 * (uploaded first with POST /photos?kind=receipt). Large ones, or ones that would leave the box
 * below its float, wait for finance.
 */
@ApiTags('store')
@ApiBearerAuth()
@Access('store')
@Controller('stores/:storeId/petty-cash')
export class StorePettyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  /** Categories and cost tags staff may choose, what the box holds, the limits and recent expenses. */
  @Get()
  async overview(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const [overview, tags] = await Promise.all([
      storePettyCash(this.prisma, storeId),
      listCostTags(this.prisma, { activeOnly: true }),
    ]);
    // The cost tags staff may put on an expense (a campaign, a project), optional.
    return {
      ...overview,
      costTags: tags.map((t) => ({ id: t.id, nameEn: t.nameEn, nameAr: t.nameAr })),
    };
  }

  @Post()
  async create(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(pettyCashSchema)) body: z.infer<typeof pettyCashSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const { attachmentIds, ...rest } = body;
    // The receipt and any further files are taken and linked in the expense's transaction.
    const result = await this.prisma.$transaction(
      async (tx) => {
        await claimRecordPhoto(tx, rest.photoId, user.sub);
        const saved = await submitPettyCash(tx, {
          ...rest,
          darkStoreId: storeId,
          actorUserId: user.sub,
        });
        const extra = attachmentIds?.filter((id) => id !== rest.photoId) ?? [];
        if (extra.length) {
          const row = await tx.pettyCashExpense.findUniqueOrThrow({
            where: { id: saved.id },
            select: { entryId: true, requestId: true },
          });
          const target = row.entryId
            ? { entryId: row.entryId }
            : row.requestId
              ? { requestId: row.requestId }
              : null;
          if (target) await linkAttachments(tx, { ids: extra, actorUserId: user.sub, target });
        }
        return saved;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    return { ...result, label: pettyCashLabel(result.number) };
  }
}
