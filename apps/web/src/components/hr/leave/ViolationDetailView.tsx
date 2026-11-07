'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { formatCairoDateTime } from '@/lib/format';
import type { ViolationDetail } from '@/lib/leave-types';
import { area, danger, day, Feedback, panel, primary, StatePill, useAction, useName } from './kit';
import { PenaltyText } from './ViolationsTable';
import { useLocale } from 'next-intl';
import { Decision } from './Decision';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="break-words text-body-sm">{children ?? '–'}</dd>
    </div>
  );
}

/**
 * One violation: what happened, the ladder step and penalty, the appeal and the decision. HR
 * use adds evidence; HR manage (never the person who recorded it) upholds or cancels it.
 */
export function ViolationDetailView({
  v,
  canUse,
  canManage,
  meId,
  evidencePath,
}: {
  v: ViolationDetail;
  canUse: boolean;
  canManage: boolean;
  meId: string | null;
  evidencePath: string;
}) {
  const t = useTranslations('hr3');
  const locale = useLocale();
  const name = useName();
  const action = useAction();
  const [note, setNote] = useState('');
  const open = v.status === 'recorded' || v.status === 'appealed';
  const mayDecide = canManage && open && v.recordedById !== meId;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="min-w-0">
        <section className={panel.replace('mt-4 ', '')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label={t('person')}>
              {name(v.employee)} <span className="ltr-iso text-caption">{v.employee.code}</span>
            </Row>
            <Row label={t('status')}>
              <StatePill status={v.status} />
            </Row>
            <Row label={t('violation')}>{name(v.type)}</Row>
            <Row label={t('date')}>{day(v.occurredOn)}</Row>
            <Row label={t('step')}>
              {t('stepOf', { step: v.step })}
              {v.step !== v.suggestedStep && (
                <span className="block text-caption text-status-needs-action">
                  {t('stepChanged', { step: v.suggestedStep, reason: v.stepReason ?? '' })}
                </span>
              )}
            </Row>
            <Row label={t('penalty')}>
              <PenaltyText p={v} />
              {v.forSupplier && (
                <span className="block text-caption text-status-needs-action">
                  {t('tellCompany', { company: v.employee.staffingSupplier?.name ?? '–' })}
                </span>
              )}
              {v.inPayroll && <span className="block text-caption">{t('inPayroll')}</span>}
            </Row>
            <Row label={t('description')}>{v.description}</Row>
            <Row label={t('recordedBy')}>
              {v.recordedBy} · {formatCairoDateTime(v.recordedAt, locale)}
            </Row>
            <Row label={t('evidence')}>
              {v.hasEvidence ? (
                <a href={evidencePath} target="_blank" rel="noreferrer" className="text-link">
                  {t('openDocument')}
                </a>
              ) : (
                t('none')
              )}
            </Row>
            <Row label={t('appealWindow')}>
              {v.status === 'recorded'
                ? t('appealUntil', { at: formatCairoDateTime(v.appealUntil, locale) })
                : v.finalAt
                  ? t('finalAt', { at: formatCairoDateTime(v.finalAt, locale) })
                  : v.appealedAt
                    ? t('appealedOn', { at: formatCairoDateTime(v.appealedAt, locale) })
                    : '–'}
            </Row>
            {v.appealReason && <Row label={t('appealByPerson')}>{v.appealReason}</Row>}
            {v.decision && (
              <Row label={t('decision')}>
                {t(`decisions.${v.decision}`)} · {v.decidedBy}: {v.decisionNote}
              </Row>
            )}
          </dl>
          {canUse && v.status !== 'cancelled' && (
            <Decision
              uploadPath={`/hr/violations/${v.id}/evidence`}
              uploadLabel={t('addEvidence')}
            />
          )}
        </section>
        {mayDecide && (
          <section className={panel}>
            <h2 className="text-h3">
              {v.status === 'appealed' ? t('decideAppeal') : t('decideNow')}
            </h2>
            <label className="mt-2 block text-caption">
              {t('decisionNote')}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} className={area} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={primary}
                disabled={action.busy || note.trim().length < 3}
                onClick={() =>
                  void action.send(
                    'POST',
                    `/hr/violations/${v.id}/decide`,
                    { decision: 'upheld', note },
                    t('saved'),
                  )
                }
              >
                {t('uphold')}
              </button>
              <button
                type="button"
                className={danger}
                disabled={action.busy || note.trim().length < 3}
                onClick={() =>
                  void action.send(
                    'POST',
                    `/hr/violations/${v.id}/decide`,
                    { decision: 'cancelled', note },
                    t('saved'),
                  )
                }
              >
                {t('cancelViolation')}
              </button>
            </div>
            <Feedback error={action.error} done={action.done} />
          </section>
        )}
        {canManage && open && v.recordedById === meId && (
          <p className="mt-3 text-caption text-text-muted">{t('notYourDecision')}</p>
        )}
      </div>
      <aside className="min-w-0">
        <section className={panel.replace('mt-4 ', '')}>
          <h2 className="text-h3">{t('ladderHistory')}</h2>
          {v.others.length === 0 ? (
            <p className="mt-2 text-body-sm text-text-muted">{t('firstOfType')}</p>
          ) : (
            <ul className="mt-2 grid gap-1 text-body-sm">
              {v.others.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/hr/violations/${o.id}`} className="ltr-iso text-link">
                    {o.number}
                  </Link>
                  {day(o.occurredOn)} · {t('stepOf', { step: o.step })}
                  <StatePill status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
