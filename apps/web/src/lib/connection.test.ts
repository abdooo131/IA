import { describe, expect, it } from 'vitest';
import { connectionLost, nextFailures } from './connection';

describe('connection health of polling screens', () => {
  it('says lost only after a few failed polls in a row, and recovers at once', () => {
    let failures = 0;
    for (const ok of [false, false]) failures = nextFailures(failures, ok);
    expect(connectionLost(failures)).toBe(false);
    failures = nextFailures(failures, false);
    expect(connectionLost(failures)).toBe(true);
    failures = nextFailures(failures, true);
    expect(failures).toBe(0);
    expect(connectionLost(failures)).toBe(false);
  });
});
