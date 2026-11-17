'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { durationParts } from '@/lib/duration';
import type { SlaStage } from '@/lib/order-types';

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
  const part = durationParts(left);
  return (
    <span
      className={`text-caption font-bold ${left < 0 ? 'text-status-needs-action' : 'text-text-muted'}`}
    >
      {left < 0 ? t('overdue', { stage: label, time: '' }) : t('dueIn', { stage: label, time: '' })}
      <bdi>{t(part.key, part.vars)}</bdi>
    </span>
  );
}
