import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { createUser, listUsers, resetUserPassword, updateUser } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type CreateUserBody,
  createUserSchema,
  isRole,
  resetPasswordSchema,
  type UpdateUserBody,
  updateUserSchema,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'q', required: false })
  list(@Query('role') role?: string, @Query('q') q?: string) {
    return listUsers(this.prisma, { role: isRole(role) ? role : undefined, q: q || undefined });
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const created = await createUser(this.prisma, { ...body, actorUserId: user.sub });
    return { id: created.id };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await updateUser(this.prisma, { ...body, userId: id, actorUserId: user.sub });
    return { id };
  }

  @Post(':id/password')
  reset(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: { password: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return resetUserPassword(this.prisma, {
      userId: id,
      password: body.password,
      actorUserId: user.sub,
    });
  }
}
