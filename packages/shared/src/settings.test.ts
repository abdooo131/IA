import { describe, expect, it } from 'vitest';
import { SETTING_DEFINITIONS, SETTING_KEYS } from './settings';

describe('setting definitions', () => {
  it('every default passes its own schema', () => {
    for (const key of SETTING_KEYS) {
      const def = SETTING_DEFINITIONS[key];
      expect(def.schema.safeParse(def.default).success, key).toBe(true);
    }
  });

  it('the stage SLAs fit inside the customer promise', () => {
    const d = SETTING_DEFINITIONS;
    const stages =
      d['sla.accept_minutes'].default +
      d['sla.pick_minutes'].default +
      d['sla.pack_minutes'].default +
      d['sla.handover_minutes'].default +
      d['sla.ride_minutes'].default;
    expect(stages).toBeLessThanOrEqual(d['sla.promise_minutes'].default);
  });

  it('rejects negative and fractional values', () => {
    expect(SETTING_DEFINITIONS['sla.pick_minutes'].schema.safeParse(-1).success).toBe(false);
    expect(SETTING_DEFINITIONS['stock.buffer_units'].schema.safeParse(1.5).success).toBe(false);
  });
});
