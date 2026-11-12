import { Controller, Delete, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DomainError, discardFinanceFile, saveFinanceFile } from '@shiplynow/db';
import type { AccessTokenClaims } from '@shiplynow/shared';
import type { Request } from 'express';
import { Access, CurrentUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Receipts and documents chosen inside a finance form (docs/ARCHITECTURE.md "Finance
 * attachments"): each file is uploaded here first and waits unlinked; the form sends the ids as
 * attachmentIds and its save links them in the same transaction. Unused uploads go after a day.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance/files')
export class FinanceFilesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Body: the file itself (image/jpeg, image/png, image/webp up to 1.5 MB, the browser shrinks
   * photos first; application/pdf up to 5 MB). ?name= keeps the file's own name.
   */
  @Post()
  @Access(['accounting', 'store'], 'use')
  @ApiQuery({ name: 'name', required: false })
  upload(
    @Req() req: Request,
    @Query('name') name: string | undefined,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (!Buffer.isBuffer(req.body)) throw new DomainError('file_type_not_allowed', 400);
    return saveFinanceFile(this.prisma, {
      contentType: req.headers['content-type'] ?? '',
      data: req.body,
      fileName: name ?? null,
      actorUserId: user.sub,
    });
  }

  /** Removes one's own upload before the form is saved. */
  @Delete(':id')
  @Access(['accounting', 'store'], 'use')
  discard(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return discardFinanceFile(this.prisma, { id, actorUserId: user.sub });
  }
}
