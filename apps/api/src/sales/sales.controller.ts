import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addContact,
  assignDeal,
  changeStage,
  completeActivity,
  createActivity,
  createCompany,
  createDeal,
  createLostReason,
  crmActor,
  dealAudit,
  dealFor,
  DomainError,
  getCompany,
  getDeal,
  listCompanies,
  listDeals,
  listLostReasons,
  myDay,
  salesPeople,
  updateActivity,
  updateCompany,
  updateContact,
  updateDeal,
  updateLostReason,
  type DealFilter,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  bulkAssignDealsSchema,
  bulkLostDealsSchema,
  bulkStageDealsSchema,
  canDo,
  CRM_SOURCES,
  CRM_STAGES,
  type CrmActivityBody,
  crmActivityDoneSchema,
  type CrmActivityDoneBody,
  crmActivitySchema,
  type CrmActivityUpdateBody,
  crmActivityUpdateSchema,
  type CrmCompanyBody,
  crmCompanySchema,
  type CrmCompanyUpdateBody,
  crmCompanyUpdateSchema,
  type CrmContactBody,
  crmContactSchema,
  type CrmContactUpdateBody,
  crmContactUpdateSchema,
  type CrmDealCreateBody,
  crmDealCreateSchema,
  type CrmDealUpdateBody,
  crmDealUpdateSchema,
  type CrmLostReasonBody,
  crmLostReasonSchema,
  type CrmLostReasonUpdateBody,
  crmLostReasonUpdateSchema,
  type CrmOwnerBody,
  crmOwnerSchema,
  type CrmSource,
  type CrmStage,
  type CrmStageBody,
  crmStageSchema,
  type DocSmartButton,
  LOST_REASON_OTHER,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { eachRecord } from '../common/bulk';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { dealsCsv } from './deals-csv';

const flag = (v?: string) => v === 'true' || v === '1';

/**
 * Sales CRM part 1 (docs/SALES.md): view reads, use adds and edits (reps with own_deals_only
 * only their own records: deal_not_allowed), manage reassigns and edits the lost reasons.
 */
@ApiTags('sales')
@ApiBearerAuth()
@Access('sales')
@Controller('sales')
export class SalesController {
  constructor(private readonly prisma: PrismaService) {}

  private actor(access: AccessProfile, user: AccessTokenClaims) {
    return crmActor(access, user.sub);
  }

  /** What the screens need around the records: sales people, lost reasons, who I am. */
  @Get('meta')
  async meta(@CurrentAccess() access: AccessProfile, @CurrentUser() user: AccessTokenClaims) {
    const [people, lostReasons] = await Promise.all([
      salesPeople(this.prisma),
      listLostReasons(this.prisma),
    ]);
    const actor = this.actor(access, user);
    return {
      me: { id: user.sub, level: actor.level, ownOnly: actor.ownOnly },
      people,
      lostReasons,
    };
  }

  private dealFilter(q: Record<string, string | undefined>): DealFilter {
    const stages = (q.stage ?? '')
      .split(',')
      .filter((s): s is CrmStage => (CRM_STAGES as readonly string[]).includes(s));
    return {
      ownerId: q.ownerId || undefined,
      unassigned: flag(q.unassigned),
      source: (CRM_SOURCES as readonly string[]).includes(q.source ?? '')
        ? (q.source as CrmSource)
        : undefined,
      stages: stages.length ? stages : undefined,
      openOnly: flag(q.open),
      needsNextStep: flag(q.needsNextStep),
      q: q.q?.slice(0, 100),
    };
  }

  @Get('deals')
  @ApiQuery({ name: 'ownerId', required: false })
  @ApiQuery({ name: 'unassigned', required: false })
  @ApiQuery({ name: 'source', required: false, enum: CRM_SOURCES })
  @ApiQuery({ name: 'stage', required: false, description: 'comma separated stages' })
  @ApiQuery({ name: 'open', required: false, description: 'true leaves out won and lost' })
  @ApiQuery({ name: 'needsNextStep', required: false })
  @ApiQuery({ name: 'q', required: false })
  deals(
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query() query: Record<string, string | undefined>,
  ) {
    return listDeals(this.prisma, this.actor(access, user), this.dealFilter(query));
  }

  @Get('deals.csv')
  async dealsCsv(
    @Res() res: Response,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query() query: Record<string, string | undefined>,
  ) {
    const deals = await listDeals(this.prisma, this.actor(access, user), {
      ...this.dealFilter(query),
      take: 2000,
    });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="shiply-deals.csv"');
    res.send(dealsCsv(deals));
  }

  @Post('deals')
  createDeal(
    @Body(new ZodValidationPipe(crmDealCreateSchema)) body: CrmDealCreateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createDeal(this.prisma, body, this.actor(access, user));
  }

  @Get('deals/:id')
  deal(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return getDeal(this.prisma, id, this.actor(access, user));
  }

  @Get('deals/:id/history')
  history(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return dealAudit(this.prisma, id, this.actor(access, user));
  }

  @Patch('deals/:id')
  updateDeal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmDealUpdateSchema)) body: CrmDealUpdateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateDeal(this.prisma, id, body, this.actor(access, user));
  }

  @Post('deals/:id/stage')
  stage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmStageSchema)) body: CrmStageBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return changeStage(this.prisma, id, body, this.actor(access, user));
  }

  /** Managers give a deal to a sales person, or back to the queue (null). */
  @Post('deals/:id/owner')
  @Access('sales', 'manage')
  owner(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmOwnerSchema)) body: CrmOwnerBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return assignDeal(this.prisma, id, body.ownerId, this.actor(access, user));
  }

  // ─── UX phase C step 4: bulk actions of the deals list and the document pages ───

  /** Managers give several deals to one sales person, or back to the queue ("none"). */
  @Post('deals/bulk-assign')
  @Access('sales', 'manage')
  bulkAssign(
    @Body(new ZodValidationPipe(bulkAssignDealsSchema)) body: z.infer<typeof bulkAssignDealsSchema>,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const actor = this.actor(access, user);
    const ownerId = body.ownerId === 'none' ? null : body.ownerId;
    return eachRecord(body.ids, async (id) => {
      const deal = await dealFor(this.prisma, id, actor);
      if (deal.ownerId === ownerId) throw new DomainError('already_owner');
      await assignDeal(this.prisma, id, ownerId, actor);
    });
  }

  /** Moves several deals to one open stage, each under the single move's rules. */
  @Post('deals/bulk-stage')
  bulkStage(
    @Body(new ZodValidationPipe(bulkStageDealsSchema)) body: z.infer<typeof bulkStageDealsSchema>,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const actor = this.actor(access, user);
    return eachRecord(body.ids, (id) => changeStage(this.prisma, id, { stage: body.stage }, actor));
  }

  /** Marks several deals lost for the reason "other" with the list's note. */
  @Post('deals/bulk-lost')
  bulkLost(
    @Body(new ZodValidationPipe(bulkLostDealsSchema)) body: z.infer<typeof bulkLostDealsSchema>,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const actor = this.actor(access, user);
    return eachRecord(body.ids, (id) =>
      changeStage(
        this.prisma,
        id,
        { stage: 'lost', lostReason: LOST_REASON_OTHER, lostNote: body.note },
        actor,
      ),
    );
  }

  /** The deal page's smart buttons: company, contacts, proposals, activities, merchant. */
  @Get('deals/:id/document')
  async dealDocument(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const deal = await dealFor(this.prisma, id, this.actor(access, user));
    const [contacts, proposals, activities, merchant] = await Promise.all([
      this.prisma.crmContact.count({ where: { companyId: deal.companyId } }),
      this.prisma.crmProposal.count({ where: { dealId: id } }),
      this.prisma.crmActivity.count({ where: { dealId: id } }),
      deal.merchantId
        ? this.prisma.merchant.findUnique({
            where: { id: deal.merchantId },
            select: { name: true },
          })
        : null,
    ]);
    const smart: DocSmartButton[] = [
      {
        key: 'company',
        count: null,
        value: deal.company.brandName,
        href: `/admin/sales/companies/${deal.companyId}`,
      },
      { key: 'contacts', count: contacts, href: `/admin/sales/deals/${id}#contacts` },
      { key: 'proposals', count: proposals, href: `/admin/sales/deals/${id}#proposals` },
      { key: 'activities', count: activities, href: `/admin/sales/deals/${id}#timeline` },
    ];
    if (merchant && canDo(access, 'merchants', 'view'))
      smart.push({
        key: 'merchant',
        count: null,
        value: merchant.name,
        href: `/admin/merchants/${deal.merchantId}`,
      });
    return { smart };
  }

  /** The company page's smart buttons: its deals, contacts and merchant. */
  @Get('companies/:id/document')
  async companyDocument(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const company = await getCompany(this.prisma, id, this.actor(access, user));
    const smart: DocSmartButton[] = [
      {
        key: 'deals',
        count: company.deals.length,
        href: `/admin/sales/deals?f=&q=${encodeURIComponent(company.brandName)}`,
      },
      {
        key: 'contacts',
        count: company.contacts.length,
        href: `/admin/sales/companies/${id}#contacts`,
      },
    ];
    if (company.merchant && canDo(access, 'merchants', 'view'))
      smart.push({
        key: 'merchant',
        count: null,
        value: company.merchant.name,
        href: `/admin/merchants/${company.merchant.id}`,
      });
    return { smart };
  }

  @Post('activities')
  createActivity(
    @Body(new ZodValidationPipe(crmActivitySchema)) body: CrmActivityBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createActivity(this.prisma, body, this.actor(access, user));
  }

  @Patch('activities/:id')
  updateActivity(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmActivityUpdateSchema)) body: CrmActivityUpdateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateActivity(this.prisma, id, body, this.actor(access, user));
  }

  @Post('activities/:id/done')
  done(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmActivityDoneSchema)) body: CrmActivityDoneBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return completeActivity(this.prisma, id, body.outcome, this.actor(access, user));
  }

  /** Today's and overdue follow ups; managers may look at one rep (ownerId) or all. */
  @Get('my-day')
  @ApiQuery({ name: 'ownerId', required: false })
  @ApiQuery({ name: 'all', required: false })
  myDay(
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query('ownerId') ownerId?: string,
    @Query('all') all?: string,
  ) {
    return myDay(this.prisma, this.actor(access, user), { ownerId, all: flag(all) });
  }

  @Get('companies')
  @ApiQuery({ name: 'q', required: false })
  companies(
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query('q') q?: string,
  ) {
    return listCompanies(this.prisma, this.actor(access, user), { q: q?.slice(0, 100) });
  }

  @Post('companies')
  createCompany(
    @Body(new ZodValidationPipe(crmCompanySchema)) body: CrmCompanyBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createCompany(this.prisma, body, this.actor(access, user));
  }

  @Get('companies/:id')
  company(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return getCompany(this.prisma, id, this.actor(access, user));
  }

  @Patch('companies/:id')
  updateCompany(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmCompanyUpdateSchema)) body: CrmCompanyUpdateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateCompany(this.prisma, id, body, this.actor(access, user));
  }

  @Post('companies/:id/contacts')
  addContact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmContactSchema)) body: CrmContactBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return addContact(this.prisma, id, body, this.actor(access, user));
  }

  @Patch('contacts/:id')
  updateContact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmContactUpdateSchema)) body: CrmContactUpdateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateContact(this.prisma, id, body, this.actor(access, user));
  }

  /** Every lost reason, switched off ones too (the configuration page). */
  @Get('lost-reasons')
  lostReasons() {
    return listLostReasons(this.prisma, { all: true });
  }

  @Post('lost-reasons')
  @Access('sales', 'manage')
  createLostReason(
    @Body(new ZodValidationPipe(crmLostReasonSchema)) body: CrmLostReasonBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createLostReason(this.prisma, body, this.actor(access, user));
  }

  @Patch('lost-reasons/:code')
  @Access('sales', 'manage')
  updateLostReason(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(crmLostReasonUpdateSchema)) body: CrmLostReasonUpdateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateLostReason(this.prisma, code, body, this.actor(access, user));
  }
}
