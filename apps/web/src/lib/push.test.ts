import { describe, expect, it } from 'vitest';
import { deviceOf, isIos, keyBytes } from './push';

describe('push helpers', () => {
  it('turns the base64url VAPID key into bytes', () => {
    expect([...keyBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });

  it('recognises iPhones, iPads and other devices', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    const ipadDesktop =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    const android =
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36';
    const windowsEdge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
    expect(isIos(iphone)).toBe(true);
    expect(isIos(ipadDesktop, 5)).toBe(true);
    expect(isIos(ipadDesktop, 0)).toBe(false);
    expect(deviceOf(iphone)).toEqual({ device: 'iphone', browser: 'safari' });
    expect(deviceOf(android)).toEqual({ device: 'android', browser: 'samsung' });
    expect(deviceOf(windowsEdge)).toEqual({ device: 'windows', browser: 'edge' });
    expect(deviceOf(null)).toEqual({ device: 'other', browser: 'other' });
  });
});
