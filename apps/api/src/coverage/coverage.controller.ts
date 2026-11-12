import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { searchServedAreas } from '@shiplynow/db';
import { type CoverageQuery, coverageQuerySchema } from '@shiplynow/shared';
import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { CoverageService } from './coverage.service';

@ApiTags('coverage')
@Controller('coverage')
export class CoverageController {
  constructor(
    private readonly coverage: CoverageService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get()
  @ApiQuery({ name: 'lat', required: false, type: Number })
  @ApiQuery({ name: 'lng', required: false, type: Number })
  @ApiQuery({ name: 'areaId', required: false, type: String })
  @ApiQuery({ name: 'address', required: false, type: String })
  @ApiOkResponse({
    description: 'covered with the dark store and zone, or not covered with a reason',
  })
  check(@Query(new ZodValidationPipe(coverageQuerySchema)) query: CoverageQuery) {
    return this.coverage.check(query);
  }

  @Public()
  @Get('areas')
  areas() {
    return this.coverage.areas();
  }

  /** Served neighbourhoods whose names hold the words typed (Arabic or English), best first. */
  @Public()
  @Get('search')
  @ApiQuery({ name: 'q', required: true, type: String })
  search(@Query('q') q = '') {
    return searchServedAreas(this.prisma, { q: String(q).slice(0, 80), limit: 10 });
  }
}
