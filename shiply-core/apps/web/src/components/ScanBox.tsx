'use client';
import { isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CameraScanner, cameraScanSupported } from './CameraScanner';
import { Icon } from './Icon';
import { cx } from './ui';

/** What a station shows after a scan: a big code (bag, hub) that can be read from a distance. */
export interface ScanOutcome {
  big?: string;
  text: ReactNode;
  warn?: ReactNode;
  tone?: 'ok' | 'return' | 'hold';
}

interface Line {
  ok: boolean;
  code: string;
  outcome: ScanOutcome;
  at: number;
}

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
  } catch {
    /* sound is optional */
  }
}

function asOutcome(r: ReactNode | ScanOutcome): ScanOutcome {
  if (r && typeof r === 'object' && !isValidElement(r) && 'text' in (r as object)) return r as ScanOutcome;
  return { text: r as ReactNode };
}

/**
 * Works with USB and Bluetooth barcode scanners (they type the code and press Enter) and with
 * typing. Keeps focus so the next scan goes straight in. The last result fills a big colored
 * panel; earlier ones list below it.
 */
export function ScanBox({
  label,
  placeholder,
  onScan,
  disabled,
  autoFocus = true,
  size = 'lg',
}: {
  label: string;
  placeholder?: string;
  onScan: (code: string) => Promise<ReactNode | ScanOutcome>;
  disabled?: boolean;
  autoFocus?: boolean;
  size?: 'lg' | 'md';
}) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [camera, setCamera] = useState(false);
  const [canCamera, setCanCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setCanCamera(cameraScanSupported()), []);

  const submit = async (typed?: string) => {
    const code = (typed ?? value).trim();
    if (!code || busy) return;
    setBusy(true);
    setValue('');
    try {
      const outcome = asOutcome(await onScan(code));
      beep(true);
      setLines((l) => [{ ok: true, code: code.toUpperCase(), outcome, at: Date.now() }, ...l].slice(0, 50));
    } catch (e) {
      beep(false);
      setLines((l) => [{ ok: false, code: code.toUpperCase(), outcome: { text: t(errorMessage(e)) }, at: Date.now() }, ...l].slice(0, 50));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const last = lines[0];
  const okCount = lines.filter((l) => l.ok).length;
  const lg = size === 'lg';
  const panel = !last
    ? ''
    : !last.ok
      ? 'border-danger bg-surface'
      : last.outcome.tone === 'return'
        ? 'border-status-returning bg-surface'
        : last.outcome.tone === 'hold'
          ? 'border-status-needs-action bg-surface'
          : 'border-status-delivered bg-surface';

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="text-caption font-semibold" htmlFor={id}>{label}</label>
        {okCount > 0 && <span className="tabular rounded-pill bg-selected-bg px-2 text-caption font-bold text-link">{t('{n} scanned', { n: okCount })}</span>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-text-muted"><Icon name="scan" size={22} /></span>
          <input
            id={id}
            ref={input}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={disabled}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder ?? t('Scan or type a code, then Enter')}
            dir="ltr"
            className={cx('field ps-11 font-mono uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal', lg ? 'min-h-14 text-h3' : 'min-h-12 text-body')}
          />
        </div>
        {canCamera && (
          <button type="button" disabled={busy || disabled} onClick={() => setCamera(true)} className={cx('btn-secondary', lg ? 'min-h-14 px-4' : 'min-h-12 px-3')} aria-label={t('Scan with the camera')} title={t('Scan with the camera')}>
            <Icon name="scan" size={22} />
          </button>
        )}
        <button type="submit" disabled={busy || disabled || !value.trim()} className={cx('btn-primary', lg ? 'min-h-14 px-6' : 'min-h-12')}>
          {busy ? '…' : t('Go')}
        </button>
      </form>
      {camera && <CameraScanner onClose={() => setCamera(false)} onCode={(code) => { setCamera(false); void submit(code); }} />}
      {last && (
        <div className={cx('mt-4 rounded-xl border-s-8 p-4 shadow-md', panel)} role="status">
          <div className="flex flex-wrap items-center gap-4">
            {last.ok && last.outcome.big && (
              <span className={cx('ltr-iso rounded-lg px-4 py-2 text-h1 font-extrabold', last.outcome.tone === 'return' ? 'bg-status-returning text-white' : last.outcome.tone === 'hold' ? 'bg-status-needs-action text-white' : 'bg-accent text-on-accent')}>
                {last.outcome.big}
              </span>
            )}
            {!last.ok && <span className="rounded-lg bg-danger px-4 py-2 text-h3 font-extrabold text-white">{t('Stop')}</span>}
            <div className="min-w-0 flex-1">
              <div className="ltr-iso font-mono text-caption text-text-muted">{last.code}</div>
              <div className="mt-0.5 text-body font-semibold">{last.outcome.text}</div>
              {last.outcome.warn && <div className="mt-1 text-body-sm font-semibold text-status-needs-action">{last.outcome.warn}</div>}
            </div>
          </div>
        </div>
      )}
      {lines.length > 1 && (
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {lines.slice(1).map((l) => (
            <li key={l.at} className="flex items-center gap-2 rounded-md bg-surface-raised px-2 py-1.5 text-caption">
              <span className={cx('h-2 w-2 shrink-0 rounded-pill', l.ok ? 'bg-status-delivered' : 'bg-danger')} />
              <span className="ltr-iso font-mono">{l.code}</span>
              {l.outcome.big && <span className="ltr-iso font-bold">{l.outcome.big}</span>}
              <span className="truncate text-text-muted">{l.outcome.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
