import { describe, expect, it } from 'vitest';
import { countSchema, createManifestSchema, moveSchema, receiveScanSchema } from './store';

describe('store schemas', () => {
  it('needs a positive whole quantity and an idempotency key on scans', () => {
    expect(
      receiveScanSchema.safeParse({ skuId: 's', quantity: 1, idempotencyKey: 'abcdefgh' }).success,
    ).toBe(true);
    expect(
      receiveScanSchema.safeParse({ skuId: 's', quantity: 0, idempotencyKey: 'abcdefgh' }).success,
    ).toBe(false);
    expect(
      receiveScanSchema.safeParse({ skuId: 's', quantity: 1.5, idempotencyKey: 'abcdefgh' })
        .success,
    ).toBe(false);
    expect(receiveScanSchema.safeParse({ skuId: 's', quantity: 1 }).success).toBe(false);
  });

  it('allows zero in a count but not negatives', () => {
    expect(
      countSchema.safeParse({ binId: 'b', lines: [{ skuId: 's', countedQty: 0 }] }).success,
    ).toBe(true);
    expect(
      countSchema.safeParse({ binId: 'b', lines: [{ skuId: 's', countedQty: -1 }] }).success,
    ).toBe(false);
  });

  it('only knows the listed move reasons', () => {
    const base = {
      skuId: 's',
      fromBinId: 'a',
      toBinId: 'b',
      quantity: 1,
      idempotencyKey: 'abcdefgh',
    };
    expect(moveSchema.safeParse({ ...base, reason: 'damaged' }).success).toBe(true);
    expect(moveSchema.safeParse({ ...base, reason: 'lost' }).success).toBe(false);
  });

  it('needs at least one line on a manifest', () => {
    expect(
      createManifestSchema.safeParse({ darkStoreId: 'd', reference: 'R1', lines: [] }).success,
    ).toBe(false);
    expect(
      createManifestSchema.safeParse({
        darkStoreId: 'd',
        reference: ' R1 ',
        lines: [{ skuId: 's', expectedQty: 5 }],
      }).data?.reference,
    ).toBe('R1');
  });
});
