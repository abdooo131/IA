import { describe, expect, it } from 'vitest';
import { barPercent, FINAL_MINUTE, localDigits, stepStates } from './ticket';

const names = (m: number) => stepStates(m).map((s) => (s.now ? 'now' : s.done ? 'done' : 'todo'));

describe('example order ticket', () => {
  it('rests at 47 minutes, delivered, with every earlier step done', () => {
    expect(FINAL_MINUTE).toBe(47);
    expect(names(47)).toEqual(['done', 'done', 'done', 'done', 'now']);
    expect(stepStates(47).filter((s) => s.now)).toHaveLength(1);
    expect(barPercent(47)).toBe(78);
  });

  it('lights each step in turn while the minutes count up', () => {
    expect(names(0)).toEqual(['now', 'todo', 'todo', 'todo', 'todo']);
    expect(names(7)).toEqual(['done', 'now', 'todo', 'todo', 'todo']);
    expect(names(12)).toEqual(['done', 'done', 'now', 'todo', 'todo']);
    expect(names(30)).toEqual(['done', 'done', 'done', 'now', 'todo']);
    expect(barPercent(0)).toBe(0);
    expect(barPercent(90)).toBe(100);
  });

  it('writes the minutes in Arabic-Indic digits on the Arabic page', () => {
    expect(localDigits(47, 'ar')).toBe('٤٧');
    expect(localDigits(47, 'en')).toBe('47');
  });
});
