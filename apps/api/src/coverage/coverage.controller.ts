import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type CoverageQuery, coverageQuerySchema } from '@shiplynow/shared';
import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CoverageService } from './coverage.service';

@ApiTags('coverage')
@Controller('coverage')
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  @Public()
  @Get()
  @ApiQuery({ name: 'lat', required: false, type: Number })
  @ApiQuery({ name: 'lng', required: false, type: Number })
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
}
