import { describe, expect, it } from 'vitest';
import {
  boardColumns,
  cairoInstant,
  type DealCard,
  daysInStage,
  dealQuery,
  moveCard,
  nextStepState,
  tomorrowInCairo,
  whatsappHref,
} from './sales';

const card = (id: string, stage: DealCard['stage'], fee: number | null = null): DealCard => ({
  id,
  number: 1,
  label: 'DEAL-000001',
  title: null,
  stage,
  expectedMonthlyOrders: null,
  expectedMonthlyFeePiastres: fee,
  expectedCloseDate: null,
  stageChangedAt: '2026-11-01T10:00:00Z',
  wonAt: null,
  lostAt: null,
  lostReason: null,
  createdAt: '2026-11-01T10:00:00Z',
  company: { id: 'c', brandName: 'Brand', source: 'manual', city: null },
  owner: null,
  nextStep: null,
});

describe('sales board', () => {
  it('puts cards in pipeline columns with their value, hiding won and lost on request', () => {
    const cards = [card('a', 'new', 100), card('b', 'new', 250), card('c', 'won', 900)];
    const all = boardColumns(cards, false);
    expect(all.map((c) => c.stage)).toEqual([
      'new',
      'contacted',
      'meeting',
      'proposal',
      'negotiation',
      'won',
      'lost',
    ]);
    expect(all[0]).toMatchObject({ value: 350 });
    expect(all[0]!.cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(boardColumns(cards, true).map((c) => c.stage)).not.toContain('won');
  });

  it('moves a card and restarts its days in stage', () => {
    const now = new Date('2026-11-07T10:00:00Z');
    const moved = moveCard([card('a', 'new'), card('b', 'new')], 'a', 'meeting', now);
    expect(moved.map((c) => c.stage)).toEqual(['meeting', 'new']);
    expect(daysInStage(moved[0]!.stageChangedAt, now)).toBe(0);
    expect(daysInStage(moved[1]!.stageChangedAt, now)).toBe(6);
  });

  it('flags open deals without a next step and overdue ones', () => {
    const now = new Date('2026-11-07T10:00:00Z');
    expect(nextStepState({ stage: 'meeting', nextStepAt: null }, now)).toBe('none');
    expect(nextStepState({ stage: 'meeting', nextStepAt: '2026-11-07T09:00:00Z' }, now)).toBe(
      'overdue',
    );
    expect(nextStepState({ stage: 'meeting', nextStepAt: '2026-11-08T09:00:00Z' }, now)).toBe(
      'planned',
    );
    expect(nextStepState({ stage: 'won', nextStepAt: null }, now)).toBe('closed');
  });
});

describe('sales forms', () => {
  it('reads a Cairo date and time as an instant (summer time and winter)', () => {
    expect(cairoInstant('2026-11-07', '09:30')).toBe('2026-11-07T07:30:00.000Z');
    expect(cairoInstant('2026-07-01', '09:30')).toBe('2026-07-01T06:30:00.000Z');
    expect(cairoInstant('2026-11-07', '25:00')).toBeNull();
    expect(cairoInstant('07/11/2026', '09:30')).toBeNull();
    expect(tomorrowInCairo(new Date('2026-11-07T22:30:00Z'))).toBe('2026-11-09');
  });

  it('builds the API query from the filters', () => {
    expect(dealQuery({})).toBe('');
    expect(dealQuery({ ownerId: 'u1', source: 'signup', q: ' nile ', open: true })).toBe(
      '?ownerId=u1&source=signup&q=nile&open=true',
    );
    expect(dealQuery({ source: 'nonsense' })).toBe('');
  });

  it('links WhatsApp only for Egyptian mobiles', () => {
    expect(whatsappHref('+201012345678')).toBe('https://wa.me/201012345678');
    expect(whatsappHref('+44 20 7946 0958')).toBeNull();
  });
});
