import { describe, expect, it } from 'vitest';
import { JOB_ROLE_TEMPLATES, NO_ACCESS } from './access';
import {
  egpText,
  isPushServiceUrl,
  PUSH_TEXT,
  pushSubscriptionSchema,
  pushText,
  pushTypesFor,
  stageWords,
} from './push';

describe('push notifications', () => {
  it('writes each notification in the device language', () => {
    const vars = { number: 'SN-1001', store: { en: 'New Cairo', ar: 'القاهرة الجديدة' } };
    expect(pushText('order_new', 'en', vars)).toEqual({
      title: 'New order SN-1001',
      body: 'Accept it at New Cairo; the clock is running.',
    });
    expect(pushText('order_new', 'ar', vars).body).toBe(
      'اقبل الطلب في القاهرة الجديدة؛ الوقت بدأ.',
    );
    expect(pushText('order_late', 'ar', { stage: stageWords('pick') }).body).toContain('التجهيز');
  });

  it('keeps titles and bodies short and fills missing values with nothing', () => {
    const long = pushText('ticket_reply', 'en', {
      number: 'TCK-1',
      name: 'A',
      body: 'x'.repeat(500),
    });
    expect(long.body.length).toBe(180);
    expect(long.body.endsWith('…')).toBe(true);
    expect(pushText('merchant_signup', 'en').body).toBe('signed up.');
  });

  it('has every text in both languages with the same values', () => {
    for (const [key, langs] of Object.entries(PUSH_TEXT)) {
      const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(names(langs.ar.join(' ')), key).toBe(names(langs.en.join(' ')));
    }
  });

  it('formats piastres as pounds without floats', () => {
    expect(egpText(250_050)).toBe('2,500.50');
    expect(egpText(5)).toBe('0.05');
    expect(egpText(-1200)).toBe('-12.00');
  });

  it('offers each person only the types their work covers', () => {
    const staff = { ...NO_ACCESS, ...JOB_ROLE_TEMPLATES.store_staff };
    expect(pushTypesFor({ kind: 'team', role: 'store_staff', profile: staff })).toEqual([
      'order_new',
      'order_late',
      'stock_arriving',
      'ticket',
      'attendance_late',
      'document_expiring',
      'hr_request',
      'hr_update',
      'payslip_ready',
      'expense_claim',
      'activity_due',
    ]);
    const finance = { ...NO_ACCESS, ...JOB_ROLE_TEMPLATES.accountant };
    expect(pushTypesFor({ kind: 'team', role: 'finance', profile: finance })).not.toContain(
      'finance_approval',
    );
    const owner = { ...NO_ACCESS, ...JOB_ROLE_TEMPLATES.owner };
    expect(pushTypesFor({ kind: 'team', role: 'admin', profile: owner })).toContain('ops_alert');
    expect(
      pushTypesFor({ kind: 'merchant', merchantRole: 'member', rights: ['money', 'stock'] }),
    ).toEqual(['merchant_payout', 'merchant_low_stock']);
    expect(pushTypesFor({ kind: 'rider' })).toContain('rider_order');
  });

  it('accepts subscriptions only on the browsers push services', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx',
      'https://api.push.apple.com/3/device/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://FCM.googleapis.com:443/fcm/send/abc',
    ])
      expect({ ok, allowed: isPushServiceUrl(ok) }).toEqual({ ok, allowed: true });
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://evil.example/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example/x',
      'https://push.apple.com/x',
      'https://evilpush.apple.com.attacker.io/x',
      'https://notify.windows.com/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://user:pass@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'not a url',
    ])
      expect({ bad, allowed: isPushServiceUrl(bad) }).toEqual({ bad, allowed: false });
    const keys = { p256dh: 'BNcRdreALRFXTkOO', auth: 'tBHItJI5svbpez7K' };
    expect(
      pushSubscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/x', keys }).success,
    ).toBe(true);
    expect(
      pushSubscriptionSchema.safeParse({ endpoint: 'https://internal.example/x', keys }).success,
    ).toBe(false);
  });
});
