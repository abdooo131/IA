import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { fileStorageStatus } from '@shiplynow/db';
import { Access } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/files')
export class FilesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Where files are kept and how many are still in the database or already in R2. */
  @Get('status')
  @Access('settings', 'manage')
  status() {
    return fileStorageStatus(this.prisma);
  }
}
