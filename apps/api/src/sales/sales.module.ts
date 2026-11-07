import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProposalsController } from './proposals.controller';
import { AccountSetupController, PublicProposalController } from './public-proposal.controller';
import { SalesNumbersController } from './sales-numbers.controller';
import { SalesController } from './sales.controller';

/**
 * The Sales app: CRM companies, contacts, deals, activities (part 1), proposals with their
 * public page, targets, the dashboard and commission (part 2). docs/SALES.md.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    SalesController,
    ProposalsController,
    SalesNumbersController,
    PublicProposalController,
    AccountSetupController,
  ],
})
export class SalesModule {}
