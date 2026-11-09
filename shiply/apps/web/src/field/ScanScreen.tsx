'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useScanQueue, type Answer } from './scanQueue';

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = ok ? 880 : 220;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
  } catch {
    /* no sound on this device */
  }
}

/** One big input that keeps focus (hardware scanners type and press Enter), and a full width answer. */
export function ScanScreen(props: { url?: string; body: Record<string, unknown>; ready?: boolean; header?: ReactNode; onAnswer?: (a: Answer) => void }) {
  const t = useTranslations('field');
  const { pending, submit } = useScanQueue();
  const [code, setCode] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [props.body]);
  const go = async () => {
    const c = code.trim();
    if (!c) return;
    setCode('');
    input.current?.focus();
    const a = await submit(props.url ?? '/parcels/scan', { ...props.body, code: c });
    if (a) {
      setAnswer(a);
      beep(a.ok);
      props.onAnswer?.(a);
    }
  };
  const reason = answer?.reason ? (t.has(`answers.${answer.reason}` as never) ? t(`answers.${answer.reason}` as never) : answer.reason) : '';
  return (
    <div className="scan-screen">
      {props.header}
      <input
        ref={input}
        className="scan-input"
        aria-label={t('scan')}
        value={code}
        disabled={props.ready === false}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void go();
        }}
        autoComplete="off"
        dir="ltr"
      />
      {pending > 0 && (
        <p className="scan-pending" data-testid="pending">
          {t('pending', { count: pending })}
        </p>
      )}
      {answer && (
        <div className={`scan-answer ${answer.colour}`} data-testid="answer" data-colour={answer.colour}>
          <strong>{answer.big}</strong>
          {answer.small && <span>{answer.small}</span>}
          {reason && <em>{reason}</em>}
        </div>
      )}
    </div>
  );
}
