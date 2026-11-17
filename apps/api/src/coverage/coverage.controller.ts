import { Controller, Get, Query, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { searchServedAreas } from '@shiplynow/db';
import { type AccessTokenClaims, type CoverageQuery, coverageQuerySchema } from '@shiplynow/shared';
import type { Request } from 'express';
import { type AuthedRequest, Public } from '../auth/decorators';
import { extractAccessToken } from '../auth/jwt-auth.guard';
import { clientAddress, LoginThrottleService } from '../auth/login-throttle.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { CoverageService } from './coverage.service';

@ApiTags('coverage')
@Controller('coverage')
export class CoverageController {
  constructor(
    private readonly coverage: CoverageService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly throttle: LoginThrottleService,
  ) {}

  /** True for a caller with a valid access token of an active account (the route is public). */
  private async signedIn(req: Request) {
    const token = extractAccessToken(req as AuthedRequest);
    if (!token) return false;
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { isActive: true },
      });
      return user?.isActive === true;
    } catch {
      return false;
    }
  }

  @Public()
  @Get()
  @ApiQuery({ name: 'lat', required: false, type: Number })
  @ApiQuery({ name: 'lng', required: false, type: Number })
  @ApiQuery({ name: 'areaId', required: false, type: String })
  @ApiQuery({ name: 'address', required: false, type: String })
  @ApiOkResponse({
    description: 'covered with the dark store and zone, or not covered with a reason',
  })
  async check(
    @Query(new ZodValidationPipe(coverageQuerySchema)) query: CoverageQuery,
    @Req() req: Request,
  ) {
    // Signed in people keep the paid address lookup. Visitors never reach Google and are
    // limited per address (the Shopify storefront has its own signed routes).
    if (await this.signedIn(req)) return this.coverage.check(query);
    this.throttle.publicCoverage(
      clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress),
    );
    return this.coverage.check(query, { lookup: false });
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
