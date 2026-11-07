import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import {
  acceptProposal,
  declineProposal,
  publicProposal,
  readSetupToken,
  useSetupToken,
} from '@shiplynow/db';
import {
  passwordSchema,
  type ProposalAcceptBody,
  proposalAcceptSchema,
  type ProposalDeclineBody,
  proposalDeclineSchema,
} from '@shiplynow/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { clientAddress, LoginThrottleService } from '../auth/login-throttle.service';
import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const setupSchema = z.object({ password: passwordSchema });

/**
 * The brand's proposal page (/p/<token>), and below it a new merchant owner's password page
 * (/setup/<token>). Public: the unguessable token in the link is the only key; answers are
 * limited per address.
 */
@ApiTags('sales')
@Controller('proposal')
export class PublicProposalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: LoginThrottleService,
  ) {}

  private limit(req: Request) {
    this.throttle.publicLink(
      clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress),
    );
  }

  /** The proposal as the brand reads it; opening it marks it viewed once. */
  @Public()
  @Get(':token')
  view(@Param('token') token: string) {
    return publicProposal(this.prisma, token);
  }

  @Public()
  @Post(':token/accept')
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(proposalAcceptSchema)) body: ProposalAcceptBody,
    @Req() req: Request,
  ) {
    this.limit(req);
    return acceptProposal(this.prisma, token, body);
  }

  @Public()
  @Post(':token/decline')
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  decline(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(proposalDeclineSchema)) body: ProposalDeclineBody,
    @Req() req: Request,
  ) {
    this.limit(req);
    return declineProposal(this.prisma, token, body);
  }
}

/** A new merchant owner's one time link to choose a password (made when a proposal is confirmed). */
@ApiTags('sales')
@Controller('auth/setup')
export class AccountSetupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: LoginThrottleService,
  ) {}

  /** Whose account a setup link opens (valid and unused). */
  @Public()
  @Get(':token')
  setup(@Param('token') token: string) {
    return readSetupToken(this.prisma, token);
  }

  /** The new owner chooses a password; the account opens and the link is used up. */
  @Public()
  @Post(':token')
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts' })
  choose(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(setupSchema)) body: z.infer<typeof setupSchema>,
    @Req() req: Request,
  ) {
    this.throttle.publicLink(
      clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress),
    );
    return useSetupToken(this.prisma, token, body.password);
  }
}
