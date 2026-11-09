import { Inject, Injectable } from '@nestjs/common';
import type { Tx } from '@shiply/db';
import { AuditService } from '../platform';
import type { CompanyKey } from './ledger.service';

export interface BillInput {
  companyKey: CompanyKey;
  payee: string;
  supplierRef?: string;
  number: string;
  date: Date;
  dueDate: Date;
  amount: number;
  vat: number;
  accountCode: string;
  preparedById: string;
}

/** What other modules may ask money to do. A bill made here still needs a second person to approve it. */
@Injectable()
export class MoneyService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async createBill(tx: Tx, input: BillInput) {
    const bill = await tx.bill.create({ data: { ...input, supplierRef: input.supplierRef ?? null } });
    await this.audit.record(tx, { userId: input.preparedById, action: 'bill.prepared', entity: 'bill', entityId: bill.id, after: bill });
    return bill;
  }
}
