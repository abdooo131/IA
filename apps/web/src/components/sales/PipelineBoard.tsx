'use client';

import type { CrmStage } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime, formatCount, formatEgp } from '@/lib/format';
import {
  BOARD_STAGES,
  boardColumns,
  type DealCard,
  daysInStage,
  type LostReason,
  moveCard,
  nextStepState,
} from '@/lib/sales';
import { LostDialog } from './LostDialog';

/**
 * The pipeline: deals as cards in stage columns. Cards are dragged to another column with a
 * mouse, or moved with their "Move to" list (keyboard and phones). Lost asks for a reason.
 */
export function PipelineBoard({
  cards: initial,
  lostReasons,
  canEdit,
  hideClosed,
}: {
  cards: DealCard[];
  lostReasons: LostReason[];
  canEdit: boolean;
  hideClosed: boolean;
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<CrmStage | null>(null);
  const [losing, setLosing] = useState<DealCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => setCards(initial), [initial]);

  const errorText = (code: string) =>
    t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');

  async function move(card: DealCard, stage: CrmStage, lost?: { reason: string; note: string }) {
    if (card.stage === stage) return;
    if (stage === 'lost' && !lost) return setLosing(card);
    setBusy(true);
    const before = cards;
    setCards(moveCard(cards, card.id, stage));
    const result = await apiSend('POST', `/sales/deals/${card.id}/stage`, {
      stage,
      ...(lost && { lostReason: lost.reason, lostNote: lost.note || null }),
    });
    setBusy(false);
    if (!result.ok) {
      setCards(before);
      setMessage({ text: errorText(result.error), error: true });
      return false;
    }
    setLosing(null);
    setMessage({
      text: t('board.moved', { company: card.company.brandName, stage: t(`stages.${stage}`) }),
      error: false,
    });
    router.refresh();
    return true;
  }

  const columns = boardColumns(cards, hideClosed);
  return (
    <>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-body-sm">
        {message && (
          <span className={message.error ? 'text-danger' : 'text-text-muted'}>{message.text}</span>
        )}
      </p>
      <div className="relative mt-2 max-w-full overflow-x-auto pb-3">
        <div className="flex gap-3">
          {columns.map((col) => (
            <section
              key={col.stage}
              aria-labelledby={`col-${col.stage}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setOver(col.stage);
              }}
              onDragLeave={() => setOver((s) => (s === col.stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const card = cards.find((c) => c.id === dragging);
                setDragging(null);
                if (card) void move(card, col.stage);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-lg border bg-surface-raised p-2 ${
                over === col.stage ? 'border-primary' : 'border-line'
              }`}
            >
              <header className="flex items-baseline justify-between gap-2 px-1 pb-2">
                <h2 id={`col-${col.stage}`} className="text-body-sm font-bold">
                  {t(`stages.${col.stage}`)}{' '}
                  <span className="font-normal text-text-muted">({col.cards.length})</span>
                </h2>
                {col.value > 0 && (
                  <span className="ltr-iso text-caption text-text-muted">
                    {t('board.value', { amount: formatEgp(col.value) })}
                  </span>
                )}
              </header>
              <ul className="space-y-2">
                {col.cards.map((card) => (
                  <li key={card.id}>
                    <DealCardView
                      card={card}
                      canEdit={canEdit && !busy}
                      onDragStart={() => setDragging(card.id)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onMove={(stage) => void move(card, stage)}
                    />
                  </li>
                ))}
                {col.cards.length === 0 && (
                  <li className="rounded-md border border-dashed border-line px-3 py-6 text-center text-caption text-text-muted">
                    {t('board.empty')}
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      </div>
      {losing && (
        <LostDialog
          company={losing.company.brandName}
          reasons={lostReasons}
          busy={busy}
          error={message?.error ? message.text : null}
          onCancel={() => {
            setLosing(null);
            setMessage(null);
          }}
          onConfirm={(reason, note) => void move(losing, 'lost', { reason, note })}
        />
      )}
    </>
  );
}

/** One deal on the board: who, how big, how long in the stage and when the next step is. */
export function DealCardView({
  card,
  canEdit,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: DealCard;
  canEdit: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onMove?: (stage: CrmStage) => void;
}) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const [now] = useState(() => new Date());
  const step = nextStepState({ stage: card.stage, nextStepAt: card.nextStep?.dueAt ?? null }, now);
  const days = daysInStage(card.stageChangedAt, now);
  return (
    <article
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={`rounded-md border border-line bg-surface p-3 shadow-sm ${canEdit ? 'cursor-grab' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/sales/deals/${card.id}`}
          className="min-w-0 font-bold text-link [overflow-wrap:anywhere]"
        >
          {card.company.brandName}
        </Link>
        <span className="ltr-iso shrink-0 text-caption text-text-muted">{card.label}</span>
      </div>
      {card.title && <p className="text-caption text-text-muted">{card.title}</p>}
      <p className="mt-1 text-caption">
        {card.owner ? card.owner.name : <span className="font-bold">{t('unassigned')}</span>}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-caption">
        <div>
          <dt className="text-text-muted">{t('card.orders')}</dt>
          <dd className="ltr-iso font-semibold">
            {card.expectedMonthlyOrders === null ? '–' : formatCount(card.expectedMonthlyOrders)}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('card.value')}</dt>
          <dd className="ltr-iso font-semibold">
            {card.expectedMonthlyFeePiastres === null
              ? '–'
              : formatEgp(card.expectedMonthlyFeePiastres)}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('card.inStage')}</dt>
          <dd className="font-semibold">{t('card.days', { days })}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('card.nextStep')}</dt>
          <dd>
            {step === 'none' ? (
              <span className="rounded-full bg-status-needs-action/15 px-2 py-0.5 font-bold text-status-needs-action">
                {t('card.noNextStep')}
              </span>
            ) : card.nextStep ? (
              <span
                className={`ltr-iso font-semibold ${step === 'overdue' ? 'text-danger' : ''}`}
                title={card.nextStep.subject}
              >
                {step === 'overdue' && <span className="sr-only">{t('card.overdue')} </span>}
                {formatCairoDateTime(card.nextStep.dueAt, locale)}
              </span>
            ) : (
              '–'
            )}
          </dd>
        </div>
      </dl>
      {canEdit && onMove && (
        <label className="mt-2 flex items-center gap-2 text-caption">
          <span className="text-text-muted">{t('card.moveTo')}</span>
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-1"
            value={card.stage}
            onChange={(e) => onMove(e.target.value as CrmStage)}
            aria-label={t('card.moveToLabel', { company: card.company.brandName })}
          >
            {BOARD_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`stages.${s}`)}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}
