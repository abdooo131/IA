import { walletTotals } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import {
  detailsText,
  type RiderWalletView,
  withdrawalDetailsProblem,
  withdrawalError,
  withdrawalPreview,
  withdrawalProblem,
} from './rider-wallet';

const owed = (outstanding: number): RiderWalletView['owed'] => ({
  duesPiastres: outstanding,
  advancePiastres: 0,
  totalPiastres: outstanding,
  outstandingPiastres: outstanding,
  charges: [],
});

const wallet = (available: number, min = 10_000): Pick<RiderWalletView, 'totals' | 'rules'> => ({
  totals: walletTotals({
    today: '2026-11-10',
    earnings: [{ amountPiastres: available, day: '2026-11-01', availableOn: '2026-11-08' }],
    paidPiastres: 0,
    owedPiastres: 0,
    pendingPiastres: 0,
  }),
  rules: { holdDays: 5, weekend: [5], minPiastres: min, maxOpen: 1, perDeliveryPiastres: 3000 },
});

describe('rider wallet display', () => {
  it('shows what leaves the wallet, what is taken first and what the rider receives', () => {
    expect(withdrawalPreview(20_000, owed(3_500))).toEqual({
      receivePiastres: 20_000,
      deductedPiastres: 3_500,
      fromWalletPiastres: 23_500,
    });
    expect(withdrawalPreview(5_000, owed(0)).fromWalletPiastres).toBe(5_000);
  });

  it('checks the amount the way the API does', () => {
    const w = wallet(25_000);
    expect(withdrawalProblem(null, w)).toBe('invalid_amount');
    expect(withdrawalProblem(30_000, w)).toBe('more_than_available');
    expect(withdrawalProblem(5_000, w)).toBe('below_minimum');
    expect(withdrawalProblem(15_000, w)).toBeNull();
    // Everything available is always allowed, even below the minimum.
    expect(withdrawalProblem(6_000, wallet(6_000))).toBeNull();
  });

  it('writes where the money goes', () => {
    expect(detailsText({ method: 'store_cash' })).toBe('');
    expect(detailsText({ method: 'instapay', handle: 'ali@instapay' })).toBe('ali@instapay');
    expect(
      detailsText({ method: 'mobile_wallet', provider: 'vodafone_cash', phone: '+201012345678' }),
    ).toBe('+201012345678');
    expect(detailsText({ method: 'bank', bankName: 'CIB', iban: 'EG00', holder: 'Ali' })).toBe(
      'CIB · EG00 · Ali',
    );
  });
});

describe('withdrawal details problems', () => {
  it('names a wrong IBAN, mobile or InstaPay address instead of a generic error', () => {
    expect(
      withdrawalDetailsProblem({ method: 'bank', bankName: 'CIB', iban: 'EG12', holder: 'Ali' }),
    ).toBe('invalid_iban');
    expect(
      withdrawalDetailsProblem({
        method: 'bank',
        bankName: 'CIB',
        iban: `EG${'1'.repeat(27)}`,
        holder: 'Ali',
      }),
    ).toBeNull();
    expect(
      withdrawalDetailsProblem({
        method: 'mobile_wallet',
        provider: 'vodafone_cash',
        phone: '123',
      }),
    ).toBe('invalid_phone');
    expect(withdrawalDetailsProblem({ method: 'instapay', handle: 'x' })).toBe('invalid_instapay');
    expect(withdrawalDetailsProblem({ method: 'store_cash' })).toBeNull();
  });

  it('reads the first known issue of an API validation answer', () => {
    expect(
      withdrawalError('validation_failed', {
        issues: [{ path: 'details.iban', message: 'invalid_iban' }],
      }),
    ).toBe('invalid_iban');
    expect(withdrawalError('validation_failed', { issues: [] })).toBe('validation_failed');
    expect(withdrawalError('below_minimum')).toBe('below_minimum');
  });
});
