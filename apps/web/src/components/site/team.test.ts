import { describe, expect, it } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { initials, parseTeam } from './team';

describe('team list', () => {
  it('reads people with up to three achievements', () => {
    const [p] = parseTeam([
      {
        name: ' Mona Adel ',
        role: 'Operations',
        summary: 'Runs the stores.',
        achievements: ['a', '', 'b', 'c', 'd'],
        photo: '/site/team/mona.jpg',
      },
    ]);
    expect(p).toEqual({
      name: 'Mona Adel',
      role: 'Operations',
      summary: 'Runs the stores.',
      achievements: ['a', 'b', 'c'],
      photo: '/site/team/mona.jpg',
      placeholder: false,
    });
  });

  it('leaves out entries without a name and anything that is not a list', () => {
    expect(parseTeam('nope')).toEqual([]);
    expect(parseTeam([null, 3, { role: 'x' }, { name: '  ' }])).toEqual([]);
  });

  it('keeps only photos under /site/team/', () => {
    const photo = (path: string) => parseTeam([{ name: 'A', photo: path }])[0]!.photo;
    expect(photo('')).toBeNull();
    expect(photo('https://evil.example/a.jpg')).toBeNull();
    expect(photo('/site/team/../secret.png')).toBeNull();
    expect(photo('/site/team/a.svg')).toBeNull();
    expect(photo('/site/team/a-b_1.webp')).toBe('/site/team/a-b_1.webp');
  });

  it('flags the placeholders the owner still has to replace', () => {
    expect(parseTeam([{ name: '[Name]' }])[0]!.placeholder).toBe(true);
  });

  it('makes initials in any script', () => {
    expect(initials('Mona Adel')).toBe('MA');
    expect(initials('mona')).toBe('M');
    expect(initials('Mona El Sayed Adel')).toBe('MA');
    expect(initials('[Name]')).toBe('N');
    expect(initials('منى عادل')).toBe('مع');
    expect(initials('—')).toBe('?');
  });

  it('has the same people in English and Arabic', () => {
    const people = (m: typeof en) => parseTeam(m.site.team.people);
    expect(people(en).length).toBeGreaterThan(0);
    expect(people(ar as typeof en).length).toBe(people(en).length);
    expect(people(ar as typeof en).map((p) => p.photo)).toEqual(people(en).map((p) => p.photo));
  });
});
