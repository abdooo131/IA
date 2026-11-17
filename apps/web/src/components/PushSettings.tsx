'use client';

import type { MyPush, PushType } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import { deviceOf, isIos, keyBytes, pushSupported, subscriptionBody } from '@/lib/push';

type DeviceState = 'checking' | 'unsupported' | 'install' | 'blocked' | 'off' | 'on' | 'working';

const card = 'mt-4 rounded-lg border border-line bg-surface p-4';

/**
 * Turns notifications on for this device (asks the browser's permission), lists the kinds of
 * notification the person receives with a switch each, sends a test and lists every device.
 */
export function PushSettings({ initial }: { initial: MyPush }) {
  const t = useTranslations('push');
  const locale = useLocale();
  const [data, setData] = useState(initial);
  const [state, setState] = useState<DeviceState>('checking');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [ios, setIos] = useState(false);

  const reload = useCallback(async () => {
    const res = await apiGetClient<MyPush>('/me/push');
    if (res.ok) setData(res.data);
  }, []);

  useEffect(() => {
    const apple = isIos(navigator.userAgent, navigator.maxTouchPoints);
    setIos(apple);
    if (!pushSupported()) {
      // Safari on iPhone offers push only to the app added to the Home Screen.
      setState(apple ? 'install' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const sub = await registration?.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('off'));
  }, []);

  async function enable() {
    if (!data.publicKey) return;
    setMessage(null);
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(data.publicKey),
        }));
      const saved = await apiSend('POST', '/me/push/subscriptions', subscriptionBody(sub, locale));
      if (!saved.ok) throw new Error(saved.error);
      setEndpoint(sub.endpoint);
      setState('on');
      setMessage({ kind: 'ok', text: t('enabled') });
      await reload();
    } catch {
      setState('off');
      setMessage({ kind: 'error', text: t('enableFailed') });
    }
  }

  async function disable() {
    setMessage(null);
    setState('working');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await apiSend('POST', '/me/push/subscriptions/remove', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    } finally {
      setEndpoint(null);
      setState('off');
      await reload();
    }
  }

  async function sendTest() {
    setMessage(null);
    const res = await apiSend<{ sent: number; failed: number; gone: number }>(
      'POST',
      '/me/push/test',
    );
    if (!res.ok) setMessage({ kind: 'error', text: t('testFailed') });
    else if (res.data.sent === 0) setMessage({ kind: 'error', text: t('testNone') });
    else setMessage({ kind: 'ok', text: t('testSent', { count: res.data.sent }) });
    await reload();
  }

  async function toggle(type: PushType, enabled: boolean) {
    setData((d) => ({
      ...d,
      types: d.types.map((x) => (x.type === type ? { ...x, enabled } : x)),
    }));
    const res = await apiSend('PUT', '/me/push/preferences', { type, enabled });
    if (!res.ok) {
      setMessage({ kind: 'error', text: t('saveFailed') });
      await reload();
    }
  }

  async function remove(id: string, own: boolean) {
    if (own) return disable();
    await apiSend('DELETE', `/me/push/subscriptions/${id}`);
    await reload();
  }

  if (!data.configured)
    return (
      <section className={card}>
        <p className="text-body-sm text-text-muted">{t('notConfigured')}</p>
      </section>
    );

  return (
    <>
      <section className={card} aria-labelledby="push-device">
        <h2 id="push-device" className="text-h3">
          {t('thisDevice')}
        </h2>
        <p className="mt-1 text-body-sm text-text-muted" aria-live="polite">
          {t(`state.${state}`)}
        </p>
        {(state === 'install' || ios) && (
          <div className="mt-3 rounded-md bg-selected-bg p-3 text-body-sm">
            <p className="font-bold">{t('iphoneTitle')}</p>
            <ol className="mt-1 list-decimal space-y-1 ps-6">
              <li>{t('iphoneStep1')}</li>
              <li>{t('iphoneStep2')}</li>
              <li>{t('iphoneStep3')}</li>
            </ol>
            <p className="mt-1 text-text-muted">{t('iphoneVersion')}</p>
          </div>
        )}
        {state === 'blocked' && (
          <p className="mt-3 rounded-md bg-selected-bg p-3 text-body-sm">{t('blockedHelp')}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {(state === 'off' || state === 'working') && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void enable()}
              disabled={state === 'working'}
            >
              {t('enable')}
            </button>
          )}
          {state === 'on' && (
            <button type="button" className="btn-secondary" onClick={() => void disable()}>
              {t('disable')}
            </button>
          )}
          {data.devices.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => void sendTest()}>
              {t('test')}
            </button>
          )}
        </div>
        {message && (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`mt-3 text-body-sm ${message.kind === 'error' ? 'text-danger' : 'text-text'}`}
          >
            {message.text}
          </p>
        )}
      </section>

      <section className={card} aria-labelledby="push-types">
        <h2 id="push-types" className="text-h3">
          {t('typesTitle')}
        </h2>
        <p className="mt-1 text-body-sm text-text-muted">{t('typesIntro')}</p>
        <ul className="mt-3 divide-y divide-line">
          {data.types.map((x) => (
            <li key={x.type} className="flex items-start justify-between gap-3 py-3">
              <label htmlFor={`push-${x.type}`} className="min-w-0">
                <span className="block text-body-sm font-bold">{t(`types.${x.type}.name`)}</span>
                <span className="block text-caption text-text-muted">
                  {t(`types.${x.type}.hint`)}
                </span>
              </label>
              <input
                id={`push-${x.type}`}
                type="checkbox"
                role="switch"
                aria-checked={x.enabled}
                checked={x.enabled}
                onChange={(e) => void toggle(x.type, e.target.checked)}
                className="mt-1 h-6 w-6 shrink-0 accent-[var(--shiply-primary)]"
              />
            </li>
          ))}
        </ul>
      </section>

      <section className={card} aria-labelledby="push-devices">
        <h2 id="push-devices" className="text-h3">
          {t('devicesTitle')}
        </h2>
        {data.devices.length === 0 ? (
          <p className="mt-1 text-body-sm text-text-muted">{t('noDevices')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {data.devices.map((d) => {
              const kind = deviceOf(d.userAgent);
              const own = d.endpoint === endpoint;
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-body-sm font-bold">
                      {t('deviceName', {
                        device: t(`device.${kind.device}`),
                        browser: t(`browser.${kind.browser}`),
                      })}
                      {own && (
                        <span className="ms-2 rounded-full bg-selected-bg px-2 py-0.5 text-caption text-link">
                          {t('thisDeviceBadge')}
                        </span>
                      )}
                    </p>
                    <p className="text-caption text-text-muted">
                      {d.lastSuccessAt
                        ? t('lastSent', { at: formatCairoDateTime(d.lastSuccessAt, locale) })
                        : t('added', { at: formatCairoDateTime(d.createdAt, locale) })}
                      {d.failures > 0 && ` · ${t('failures', { count: d.failures })}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="h-10 shrink-0 rounded-md border border-line px-3 text-body-sm font-bold text-link"
                    onClick={() => void remove(d.id, own)}
                  >
                    {t('remove')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
