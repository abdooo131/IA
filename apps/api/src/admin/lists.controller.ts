import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { appListOptions, type ListScope, queryAppList } from '@shiplynow/db';
import {
  type AccessApp,
  type AccessProfile,
  type AccessTokenClaims,
  appListMeta,
  appListNeedsCustomerData,
  canDo,
  type ListQuery,
  listQuerySchema,
} from '@shiplynow/shared';
import { limitedMerchants, limitedStores } from '../auth/access-scope';
import { Access, ANY_APP, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The list views of the apps besides Accounting (UX phase C; APP_LISTS in packages/shared):
 * GET /lists/<app>/<id> with the list state as query (q, f, g, sort, desc, page, size, v;
 * open for a group's rows, all=1 for exports). Reading needs view on the list's app; rows stay
 * inside the person's stores and merchants.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Access(ANY_APP)
@Controller('lists')
export class ListsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private scope(app: string, id: string, user: AccessTokenClaims, access: AccessProfile) {
    if (!appListMeta(app, id)) throw new NotFoundException({ error: 'list_not_found' });
    if (!canDo(access, app as AccessApp, 'view'))
      throw new ForbiddenException({ error: 'no_access' });
    if (appListNeedsCustomerData(app, id) && !access.customerData)
      throw new ForbiddenException({ error: 'no_access' });
    const scope: ListScope = {
      userId: user.sub,
      storeIds: limitedStores(access),
      merchantIds: limitedMerchants(access),
      access,
    };
    return scope;
  }

  @Get(':app/:id')
  async list(
    @Param('app') app: string,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const scope = this.scope(app, id, user, access);
    return queryAppList(this.prisma, app, id, query, scope, this.clock.now());
  }

  /** What the list's value filters offer: the person's stores, merchants, alert types. */
  @Get(':app/:id/options')
  options(
    @Param('app') app: string,
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const scope = this.scope(app, id, user, access);
    return appListOptions(this.prisma, app, id, scope);
  }
}
