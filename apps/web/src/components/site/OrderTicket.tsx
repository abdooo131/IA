'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { barPercent, FINAL_MINUTE, localDigits, stepStates } from './ticket';

const STEPS = ['s1', 's2', 's3', 's4', 's5'] as const;
const TIMES = ['t1', 't2', 't3', 't4', 't5'] as const;
/** Pause before the replay starts, then one minute every 70 ms (as in the agreed preview). */
const START_DELAY_MS = 900;
const TICK_MS = 70;

/**
 * The hero's example order. Server rendered at its resting state (47 minutes, delivered), so it
 * is complete without JavaScript; with motion allowed it replays the order once.
 */
export function OrderTicket() {
  const t = useTranslations('site.ticket');
  const locale = useLocale();
  const [minute, setMinute] = useState<number>(FINAL_MINUTE);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let tick: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      let m = 0;
      setMinute(m);
      tick = setInterval(() => {
        m += 1;
        setMinute(m);
        if (m >= FINAL_MINUTE) clearInterval(tick);
      }, TICK_MS);
    }, START_DELAY_MS);
    return () => {
      clearTimeout(start);
      if (tick) clearInterval(tick);
    };
  }, []);

  const states = stepStates(minute);
  return (
    <article className="s-ticket" aria-label={t('label')}>
      <div className="s-ticket-head">
        <div>
          <div className="s-ticket-no">{t('number')}</div>
          <div className="s-ticket-store">{t('store')}</div>
        </div>
        <div className="s-ticket-store">{t('cod')}</div>
      </div>
      <div className="s-timer">
        <span className="s-num">{localDigits(minute, locale)}</span>
        <span className="s-of">{t('of')}</span>
      </div>
      <div className="s-bar">
        <i style={{ width: `${barPercent(minute)}%` }} />
      </div>
      <ol className="s-steps">
        {STEPS.map((step, i) => (
          <li
            key={step}
            className={[states[i]!.done && 's-done', states[i]!.now && 's-now']
              .filter(Boolean)
              .join(' ')}
          >
            <span className="s-dot" />
            <span>{t(step)}</span>
            <time>{t(TIMES[i]!)}</time>
          </li>
        ))}
      </ol>
      <div className="s-ticket-foot">
        <span>{t('collected')}</span>
        <b aria-hidden="true">{t('check')}</b>
      </div>
      <p className="s-sample">{t('sample')}</p>
    </article>
  );
}
