import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createMerchantTeamUser,
  DomainError,
  getMerchantAccess,
  listMerchantTeam,
  resetMerchantTeamPassword,
  updateMerchantTeamUser,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type CreateTeamMemberBody,
  createTeamMemberSchema,
  resetPasswordSchema,
  type UpdateTeamMemberBody,
  updateTeamMemberSchema,
} from '@shiplynow/shared';
import { CurrentUser, MerchantRight, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The merchant's own team (docs/ACCESS.md): owners add people, choose their rights, disable
 * them and reset their passwords. An owner cannot remove themselves and the merchant always
 * keeps one active owner.
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@MerchantRight('owner')
@Controller('merchant/team')
export class MerchantTeamController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AccessTokenClaims) {
    const me = await getMerchantAccess(this.prisma, user.sub);
    if (!me) throw new DomainError('merchant_required', 403);
    return listMerchantTeam(this.prisma, me.merchantId);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createTeamMemberSchema)) body: CreateTeamMemberBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createMerchantTeamUser(this.prisma, { ...body, actorUserId: user.sub });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTeamMemberSchema)) body: UpdateTeamMemberBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateMerchantTeamUser(this.prisma, { ...body, userId: id, actorUserId: user.sub });
  }

  /** Signs the person out everywhere and stops them signing in. */
  @Post(':id/disable')
  disable(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return updateMerchantTeamUser(this.prisma, {
      userId: id,
      isActive: false,
      actorUserId: user.sub,
    });
  }

  @Post(':id/password')
  reset(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: { password: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return resetMerchantTeamPassword(this.prisma, {
      userId: id,
      password: body.password,
      actorUserId: user.sub,
    });
  }
}
