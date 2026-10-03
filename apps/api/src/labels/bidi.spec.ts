import { breakLines, visualRuns } from './bidi';

describe('label bidi helper', () => {
  it('leaves pure Latin untouched', () => {
    expect(visualRuns('12 Road 9, Maadi')).toEqual([{ text: '12 Road 9, Maadi', rtl: false }]);
  });
  it('orders mixed runs right to left and keeps Latin runs intact', () => {
    const runs = visualRuns('فستان أسود مقاس M');
    expect(runs.map((r) => r.rtl)).toEqual([false, true]);
    expect(runs[0].text).toBe('M');
  });
  it('keeps Arabic-Indic numbers readable', () => {
    const runs = visualRuns('شارع ١٢');
    expect(runs).toHaveLength(1);
    expect(runs[0].text.split(' ')).toEqual(['٢١', 'شارع']);
  });
  it('breaks lines in logical order', () => {
    expect(breakLines('a bb ccc dddd', 6, (w) => w.length)).toEqual(['a bb', 'ccc', 'dddd']);
  });
});
