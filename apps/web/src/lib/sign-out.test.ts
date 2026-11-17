import { describe, expect, it, vi } from 'vitest';
import { forgetPushDevice } from './sign-out';

describe('forgetPushDevice', () => {
  it('tells the server to forget this device and clears the sync mark', async () => {
    const post = vi.fn(async () => undefined);
    const clearMark = vi.fn();
    await forgetPushDevice({
      subscription: async () => ({ endpoint: 'https://push.example/abc' }),
      post,
      clearMark,
    });
    expect(post).toHaveBeenCalledWith('/me/push/subscriptions/remove', {
      endpoint: 'https://push.example/abc',
    });
    expect(clearMark).toHaveBeenCalled();
  });

  it('sends nothing when the device has no subscription', async () => {
    const post = vi.fn(async () => undefined);
    await forgetPushDevice({ subscription: async () => null, post, clearMark: () => {} });
    expect(post).not.toHaveBeenCalled();
  });

  it('never blocks signing out: failures and slow answers are let go', async () => {
    await expect(
      forgetPushDevice({
        subscription: async () => {
          throw new Error('no worker');
        },
        clearMark: () => {
          throw new Error('private mode');
        },
      }),
    ).resolves.toBeUndefined();
    const started = Date.now();
    await forgetPushDevice({
      subscription: async () => ({ endpoint: 'https://push.example/abc' }),
      post: () => new Promise(() => {}),
      clearMark: () => {},
      waitMs: 20,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
