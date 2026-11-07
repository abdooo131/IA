'use client';
import { useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { cx } from './ui';

export interface ScanLine {
  ok: boolean;
  code: string;
  text: ReactNode;
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

/**
 * Works with USB and Bluetooth barcode scanners (they type the code and press Enter) and
 * with typing by hand. Keeps focus so the next scan goes straight in.
 */
export function ScanBox({
  label,
  placeholder = 'Scan or type a code, then Enter',
  onScan,
  disabled,
}: {
  label: string;
  placeholder?: string;
  onScan: (code: string) => Promise<ReactNode>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<ScanLine[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true);
    setValue('');
    try {
      const text = await onScan(code);
      beep(true);
      setLines((l) => [{ ok: true, code, text, at: Date.now() }, ...l].slice(0, 30));
    } catch (e) {
      beep(false);
      setLines((l) => [{ ok: false, code, text: errorMessage(e), at: Date.now() }, ...l].slice(0, 30));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const last = lines[0];
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="scan">{label}</label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex gap-2"
      >
        <input
          id="scan"
          ref={input}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="block min-h-12 w-full rounded-lg border-0 bg-white px-3 font-mono text-base uppercase tracking-wider ring-2 ring-inset ring-brand-500 focus:ring-brand-700 disabled:bg-slate-100"
        />
        <button type="submit" disabled={busy || disabled || !value.trim()} className="min-h-12 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white disabled:bg-brand-500/50">
          {busy ? '…' : 'Go'}
        </button>
      </form>
      {last && (
        <div className={cx('mt-3 rounded-lg px-4 py-3 text-sm font-medium ring-1', last.ok ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-rose-50 text-rose-900 ring-rose-200')} role="status">
          <div className="font-mono text-xs opacity-70">{last.code}</div>
          <div className="mt-0.5 text-base">{last.text}</div>
        </div>
      )}
      {lines.length > 1 && (
        <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-xs">
          {lines.slice(1).map((l) => (
            <li key={l.at} className={cx('flex gap-2 rounded px-2 py-1', l.ok ? 'bg-slate-50 text-slate-700' : 'bg-rose-50 text-rose-800')}>
              <span className="font-mono">{l.code}</span>
              <span className="truncate">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
