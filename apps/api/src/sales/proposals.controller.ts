import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  approveProposal,
  confirmProposal,
  createProposal,
  crmActor,
  dealProposals,
  listProposals,
  newOwnerSetupLink,
  requestProposalApproval,
  sendProposal,
  setDealAccountManager,
  updateProposal,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  crmOwnerSchema,
  type CrmOwnerBody,
  PROPOSAL_STATUSES,
  type ProposalConfirmBody,
  proposalConfirmSchema,
  type ProposalCreateBody,
  proposalCreateSchema,
  type ProposalUpdateBody,
  proposalUpdateSchema,
} from '@shiplynow/shared';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sales CRM part 2, proposals (docs/SALES.md 8): view reads, use makes, edits, sends and
 * confirms (a rep only on their own deals: deal_not_allowed), manage approves discounts past
 * sales.max_discount_bp and changes a won merchant's account manager. Confirming opens the
 * merchant, its owner login and its contract even for a rep without merchants manage.
 */
@ApiTags('sales')
@ApiBearerAuth()
@Access('sales')
@Controller('sales')
export class ProposalsController {
  constructor(private readonly prisma: PrismaService) {}

  private actor(access: AccessProfile, user: AccessTokenClaims) {
    return crmActor(access, user.sub);
  }

  /**
   * The zones a proposal prices (owner, 2026-11-08: every price in the agreement): Shiply Now's
   * delivery zones and Shiply's route zones with their list prices.
   */
  @Get('price-zones')
  async priceZones() {
    const [nowZones, parcelZones] = await Promise.all([
      this.prisma.zone.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameAr: true,
          darkStore: { select: { code: true, nameEn: true, nameAr: true } },
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.pricingZone.findMany({
        select: {
          code: true,
          name: true,
          priceS: true,
          priceM: true,
          priceL: true,
          priceXL: true,
          priceXXL: true,
          priceBulky: true,
        },
        orderBy: { code: 'asc' },
      }),
    ]);
    return { nowZones, parcelZones };
  }

  @Get('proposals')
  @ApiQuery({ name: 'status', required: false, enum: PROPOSAL_STATUSES })
  @ApiQuery({ name: 'needsApproval', required: false })
  proposals(
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query('status') status?: string,
    @Query('needsApproval') needsApproval?: string,
  ) {
    return listProposals(this.prisma, this.actor(access, user), {
      status: (PROPOSAL_STATUSES as readonly string[]).includes(status ?? '') ? status : undefined,
      needsApproval: needsApproval === 'true',
    });
  }

  /** A deal's proposals and the fee settings a new one starts from. */
  @Get('deals/:id/proposals')
  dealProposals(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return dealProposals(this.prisma, id, this.actor(access, user));
  }

  @Post('proposals')
  create(
    @Body(new ZodValidationPipe(proposalCreateSchema)) body: ProposalCreateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createProposal(this.prisma, body, this.actor(access, user));
  }

  @Patch('proposals/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(proposalUpdateSchema)) body: ProposalUpdateBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateProposal(this.prisma, id, body, this.actor(access, user));
  }

  /** The rep asks a sales manager to approve a discount past the limit. */
  @Post('proposals/:id/request-approval')
  requestApproval(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return requestProposalApproval(this.prisma, id, this.actor(access, user));
  }

  @Post('proposals/:id/approve')
  @Access('sales', 'manage')
  approve(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return approveProposal(this.prisma, id, this.actor(access, user));
  }

  @Post('proposals/:id/send')
  send(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return sendProposal(this.prisma, id, this.actor(access, user));
  }

  /**
   * The brand accepted online: the rep confirms, and the merchant, its owner login (with a one
   * time setup link, shown once), its contract and fees are made and the deal is won.
   */
  @Post('proposals/:id/confirm')
  confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(proposalConfirmSchema)) body: ProposalConfirmBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return confirmProposal(this.prisma, id, body, this.actor(access, user));
  }

  /** A new one time link for the won merchant's owner who has not chosen a password yet. */
  @Post('deals/:id/setup-link')
  setupLink(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return newOwnerSetupLink(this.prisma, id, this.actor(access, user));
  }

  /** A sales manager changes who looks after the won merchant. */
  @Post('deals/:id/account-manager')
  @Access('sales', 'manage')
  accountManager(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(crmOwnerSchema)) body: CrmOwnerBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setDealAccountManager(this.prisma, id, body.ownerId, this.actor(access, user));
  }
}
