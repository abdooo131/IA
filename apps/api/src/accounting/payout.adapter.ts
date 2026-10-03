import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

export interface PayoutRequest {
  /** Our cashout id; the provider must treat it as an idempotency key. */
  idempotencyKey: string;
  method: 'BANK' | 'FAWRY_ACCOUNT' | 'FAWRY_CARD';
  destination: string;
  amount: number;
}

/** Adapter boundary for paying merchants. Real bank / Fawry implementations come with credentials. */
export interface PayoutAdapter {
  pay(req: PayoutRequest): Promise<{ reference: string }>;
}

export const PAYOUT = Symbol('PAYOUT');

/** Mock: always succeeds with a deterministic reference, so retries return the same reference. */
@Injectable()
export class MockPayoutAdapter implements PayoutAdapter {
  async pay(req: PayoutRequest) {
    const h = createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 10).toUpperCase();
    const prefix = req.method === 'BANK' ? 'BANK' : 'FAWRY';
    return { reference: `MOCK-${prefix}-${h}` };
  }
}
