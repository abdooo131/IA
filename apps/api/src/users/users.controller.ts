import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/decorators';
import { toPublicUser } from '../auth/auth.service';
import { PublicUserDto } from '../auth/dto';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Access('settings', 'manage')
  @ApiOkResponse({ type: [PublicUserDto] })
  async list(): Promise<PublicUserDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toPublicUser);
  }
}
