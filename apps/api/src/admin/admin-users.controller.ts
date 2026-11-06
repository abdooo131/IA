import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createUser,
  getUserAccess,
  listUsers,
  resetUserPassword,
  setUserAccess,
  updateUser,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type CreateUserBody,
  createUserSchema,
  JOB_ROLE_TEMPLATES,
  JOB_ROLES,
  type SetAccessBody,
  setAccessSchema,
  isRole,
  resetPasswordSchema,
  type UpdateUserBody,
  updateUserSchema,
} from '@shiplynow/shared';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Access('settings', 'manage')
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

  /** A team member's access profile and stores (docs/ACCESS.md). */
  @Get(':id/access')
  access(@Param('id') id: string) {
    return getUserAccess(this.prisma, id);
  }

  /** Sets access from a job role or custom values; never one's own, audited. */
  @Put(':id/access')
  async setAccess(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setAccessSchema)) body: SetAccessBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await setUserAccess(this.prisma, { userId: id, body, actorUserId: user.sub });
    return getUserAccess(this.prisma, id);
  }
}

/** The ready made job roles that fill a profile in one click. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('settings', 'manage')
@Controller('admin/access')
export class AdminAccessController {
  @Get('job-roles')
  jobRoles() {
    return JOB_ROLES.map((jobRole) => ({ jobRole, ...JOB_ROLE_TEMPLATES[jobRole] }));
  }
}
