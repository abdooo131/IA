import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getContract, saveContract } from '@shiplynow/db';
import { type AccessTokenClaims, type ContractBody, contractSchema } from '@shiplynow/shared';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A merchant's contract (dates, volume tiers, monthly minimum, security deposit, credit
 * limit). Merchants (and Accounting) read it; merchants manage edits it.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/merchants')
export class AdminContractsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get(':id/contract')
  @Access(['merchants', 'accounting'], 'view', { merchantParam: 'id' })
  contract(@Param('id') id: string) {
    return getContract(this.prisma, id, this.clock.now());
  }

  @Put(':id/contract')
  @Access('merchants', 'manage', { merchantParam: 'id' })
  async save(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contractSchema)) body: ContractBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await saveContract(this.prisma, { ...body, merchantId: id, actorUserId: user.sub });
    return getContract(this.prisma, id, this.clock.now());
  }
}
