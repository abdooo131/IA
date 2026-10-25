'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { SlaStage } from '@/lib/order-types';

function mmss(ms: number) {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Live countdown for the current SLA stage; turns into "late by" once it passes. */
export function StageTimer({ stage, dueAt }: { stage: SlaStage; dueAt: string }) {
  const t = useTranslations('orders');
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const left = new Date(dueAt).getTime() - now;
  const label = t(`stages.${stage}`);
  return (
    <span className={`text-caption font-bold ${left < 0 ? 'text-status-needs-action' : 'text-text-muted'}`}>
      {left < 0 ? t('overdue', { stage: label, time: '' }) : t('dueIn', { stage: label, time: '' })}
      <span className="ltr-iso">{mmss(left)}</span>
    </span>
  );
}
