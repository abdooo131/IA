import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import {
  formatHistoryValue,
  humanise,
  humaniseAction,
  isIdField,
  readableValue,
} from './history-format';
import { statusTone } from './status-tone';

const opts = { locale: 'en', yes: 'Yes', no: 'No', state: (s: string) => `[${s}]` };

describe('History panel wording', () => {
  it('shows money in EGP, shares in percent and days day first', () => {
    expect(formatHistoryValue('amount', 1_350_000, opts)).toBe('13,500.00 EGP');
    expect(formatHistoryValue('amountPiastres', 1000, opts)).toBe('10.00 EGP');
    expect(formatHistoryValue('whtBp', 300, opts)).toBe('3%');
    expect(formatHistoryValue('day', '2026-11-03', opts)).toBe('03/11/2026');
    expect(formatHistoryValue('month', '2026-10', opts)).toBe('10/2026');
    expect(formatHistoryValue('status', 'pending', opts)).toBe('[pending]');
    expect(formatHistoryValue('isActive', false, opts)).toBe('No');
    expect(formatHistoryValue('count', 3, opts)).toBe('3');
  });

  it('never shows a raw key or id', () => {
    expect(humaniseAction('finance.request_create')).toBe('Finance: request create');
    expect(humanise('amountPiastres')).toBe('Amount');
    expect(humanise('decisionNote')).toBe('Decision note');
    expect(isIdField('entryId')).toBe(true);
    expect(isIdField('attachmentIds')).toBe(true);
    expect(isIdField('reference')).toBe(false);
    expect(readableValue('ckz1abcdefghijklmnopqrstu')).toBe(false);
    expect(readableValue('JV-000012')).toBe(true);
  });

  it('words every finance, Basata, payout, request, cheque and tax action', () => {
    const actions = en.admin.audit.actions as Record<string, string>;
    for (const a of [
      'finance.request_create',
      'finance.request_approve',
      'finance.request_reject',
      'finance.tax_payment',
      'finance.payout_approve',
      'finance.payout_proof',
      'finance.cheque_register',
      'basata_deposit.submit',
      'basata_deposit.approve',
      'rider_withdrawal.pay',
      'expense_claim.pay',
    ])
      expect(actions[a.replace('.', '__')], a).toBeTruthy();
  });
});

describe('status tones', () => {
  it('colors each status by what it means', () => {
    expect(statusTone('paid')).toBe('done');
    expect(statusTone('approved')).toBe('progress');
    expect(statusTone('pending')).toBe('waiting');
    expect(statusTone('bounced')).toBe('stopped');
    expect(statusTone('cancelled')).toBe('neutral');
    expect(statusTone('something_new')).toBe('neutral');
  });
});
