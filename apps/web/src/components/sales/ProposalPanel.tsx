'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import {
  bpText,
  type DealProposals,
  proposalActions,
  proposalLink,
  type ProposalView,
  setupLink,
} from '@/lib/sales-part2';
import { ProposalForm } from './ProposalForm';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/** The colour of a proposal's status. */
export function ProposalStatusPill({ status }: { status: string }) {
  const t = useTranslations('sales.proposals');
  const tone =
    status === 'accepted'
      ? 'text-success'
      : status === 'declined' || status === 'expired'
        ? 'text-danger'
        : status === 'sent' || status === 'viewed'
          ? 'text-link'
          : 'text-text-muted';
  return (
    <span className={`rounded-pill border border-line px-2.5 py-0.5 text-caption ${tone}`}>
      {t(`statuses.${status}`)}
    </span>
  );
}

/**
 * The deal page's proposals: every version newest first, a new one, editing a draft, the
 * manager's approval of a discount, sending, the link to copy and, once the brand accepted,
 * the rep's confirmation that opens the merchant (with the owner's one time setup link).
 */
export function ProposalPanel({
  dealId,
  data,
  me,
  open,
  expectedOrders,
  contact,
  hasMerchant,
}: {
  dealId: string;
  data: DealProposals;
  me: { id: string; canEdit: boolean; canManage: boolean };
  /** The deal is still open (a new proposal can be made) */
  open: boolean;
  expectedOrders: number | null;
  contact: { name: string; email: string | null; phone: string | null } | null;
  /** The company is a merchant already (a sign up): no owner login is made */
  hasMerchant: boolean;
}) {
  const t = useTranslations('sales.proposals');
  const te = useTranslations('sales.errors');
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<{ kind: 'new' } | { kind: 'edit'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [owner, setOwner] = useState({
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
  });
  const [setup, setSetup] = useState<string | null>(null);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend<{ setupToken?: string | null }>('POST', path, body ?? {});
    setBusy(false);
    if (!result.ok) {
      setError(te.has(result.error) ? te(result.error) : te('generic'));
      return null;
    }
    router.refresh();
    return result.data;
  }

  async function copy(p: ProposalView) {
    const link = proposalLink(origin, p.token!);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(p.id);
    } catch {
      window.prompt(t('copyLink'), link);
    }
  }

  async function confirm(p: ProposalView) {
    const body = hasMerchant
      ? {}
      : {
          ownerName: owner.name.trim() || undefined,
          ownerEmail: owner.email.trim() || undefined,
          ownerPhone: owner.phone.trim() || null,
        };
    const data = await act(`/sales/proposals/${p.id}/confirm`, body);
    if (data) {
      setConfirming(null);
      if (data.setupToken) setSetup(setupLink(origin, data.setupToken));
    }
  }

  const editing = mode?.kind === 'edit' ? data.proposals.find((p) => p.id === mode.id) : undefined;
  const fee = (p: ProposalView) =>
    t('orderFeeLine', {
      fixed: formatEgp(p.fees.orderFixedPiastres),
      percent: bpText(p.fees.orderPercentBp),
    });
  const when = (iso: string | null) => (iso ? formatCairoDateTime(iso, locale) : '');

  return (
    <section
      id="proposals"
      aria-labelledby="proposals-title"
      className="scroll-mt-20 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="proposals-title" className="text-h3">
          {t('title')}
        </h2>
        {me.canEdit && open && !mode && (
          <button type="button" className="btn-primary" onClick={() => setMode({ kind: 'new' })}>
            {data.proposals.length ? t('newVersion') : t('new')}
          </button>
        )}
      </div>
      {setup && (
        <div role="status" className="mt-3 rounded-md border border-success p-3 text-body-sm">
          <p className="font-bold">{t('setupReady')}</p>
          <p className="mt-1 text-caption text-text-muted">{t('setupHint')}</p>
          <input
            readOnly
            dir="ltr"
            className={`${field} mt-2`}
            value={setup}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('setupLink')}
          />
        </div>
      )}
      {mode && (
        <ProposalForm
          key={mode.kind === 'edit' ? mode.id : 'new'}
          dealId={dealId}
          proposal={editing}
          defaults={data.defaults}
          maxDiscountBp={data.maxDiscountBp}
          expectedOrders={expectedOrders}
          onCancel={() => setMode(null)}
          onDone={() => {
            setMode(null);
            router.refresh();
          }}
        />
      )}
      {error && (
        <p role="alert" className="mt-3 text-body-sm text-danger">
          {error}
        </p>
      )}
      {data.proposals.length === 0 && !mode && (
        <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
      )}
      <ol className="mt-3 space-y-3">
        {data.proposals.map((p) => {
          const can = proposalActions(p, me);
          return (
            <li key={p.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ltr-iso font-bold">{p.label}</span>
                <span className="text-caption text-text-muted">
                  {t('version', { n: p.version })}
                </span>
                <ProposalStatusPill status={p.status} />
                {p.needsApproval && (
                  <span className="text-caption font-bold text-status-needs-action">
                    {p.approvedAt
                      ? t('approvedBy', { name: p.approvedBy?.name ?? '' })
                      : p.approvalRequestedAt
                        ? t('waitingApproval', { discount: bpText(p.maxDiscountBp) })
                        : t('discountOver', { discount: bpText(p.maxDiscountBp) })}
                  </span>
                )}
              </div>
              <p className="mt-1 text-body-sm">
                {fee(p)} · {t('codLine', { percent: bpText(p.fees.codPercentBp) })}
                {p.tiers.length > 0 && ` · ${t('tiersCount', { n: p.tiers.length })}`}
              </p>
              {p.example.orders > 0 && (
                <p className="text-caption text-text-muted">
                  {t('exampleShort', {
                    orders: p.example.orders,
                    total: formatEgp(p.example.totalPiastres),
                  })}
                </p>
              )}
              <p className="mt-1 text-caption text-text-muted">
                {t('madeBy', { name: p.createdBy.name })}
                {p.sentAt && ` · ${t('sentAt', { when: when(p.sentAt) })}`}
                {p.validUntil && ` · ${t('validUntil', { day: p.validUntil })}`}
                {p.viewedAt && ` · ${t('viewedAt', { when: when(p.viewedAt) })}`}
              </p>
              {p.acceptedAt && (
                <p className="mt-1 text-body-sm font-semibold text-success">
                  {t('acceptedBy', {
                    name: p.signerName ?? '',
                    title: p.signerTitle ?? '',
                    when: when(p.acceptedAt),
                  })}
                </p>
              )}
              {p.declinedAt && (
                <p className="mt-1 text-body-sm text-danger">
                  {t('declinedBy', { name: p.signerName ?? '', when: when(p.declinedAt) })}
                  {p.declineReason && ` · ${p.declineReason}`}
                </p>
              )}
              {p.confirmedAt && p.merchant && (
                <p className="mt-1 text-body-sm">
                  {t('confirmedBy', { name: p.confirmedBy?.name ?? '', when: when(p.confirmedAt) })}{' '}
                  <Link href={`/admin/merchants/${p.merchant.id}`} className="text-link">
                    {p.merchant.name}
                  </Link>
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {can.edit && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !!mode}
                    onClick={() => setMode({ kind: 'edit', id: p.id })}
                  >
                    {t('edit')}
                  </button>
                )}
                {can.requestApproval && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void act(`/sales/proposals/${p.id}/request-approval`)}
                  >
                    {t('requestApproval')}
                  </button>
                )}
                {can.approve && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/sales/proposals/${p.id}/approve`)}
                  >
                    {t('approve')}
                  </button>
                )}
                {can.send && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void act(`/sales/proposals/${p.id}/send`)}
                  >
                    {t('send')}
                  </button>
                )}
                {can.copyLink && p.token && (
                  <>
                    <button type="button" className="btn-secondary" onClick={() => void copy(p)}>
                      {copied === p.id ? t('copied') : t('copyLink')}
                    </button>
                    <a
                      href={`/p/${p.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                    >
                      {t('openLink')}
                    </a>
                  </>
                )}
                {can.confirm && confirming !== p.id && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => setConfirming(p.id)}
                  >
                    {t('confirm')}
                  </button>
                )}
              </div>
              {confirming === p.id && (
                <form
                  className="mt-3 grid gap-3 rounded-md bg-surface-raised p-3 sm:grid-cols-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirm(p);
                  }}
                >
                  <p className="text-body-sm sm:col-span-3">
                    {hasMerchant ? t('confirmExisting') : t('confirmIntro')}
                  </p>
                  {!hasMerchant && (
                    <>
                      <label className="text-body-sm">
                        <span className="font-semibold">{t('ownerName')}</span>
                        <input
                          className={`${field} mt-1`}
                          value={owner.name}
                          required
                          onChange={(e) => setOwner({ ...owner, name: e.target.value })}
                        />
                      </label>
                      <label className="text-body-sm">
                        <span className="font-semibold">{t('ownerEmail')}</span>
                        <input
                          className={`${field} mt-1`}
                          type="email"
                          dir="ltr"
                          required
                          value={owner.email}
                          onChange={(e) => setOwner({ ...owner, email: e.target.value })}
                        />
                      </label>
                      <label className="text-body-sm">
                        <span className="font-semibold">{t('ownerPhone')}</span>
                        <input
                          className={`${field} mt-1`}
                          inputMode="tel"
                          dir="ltr"
                          value={owner.phone}
                          onChange={(e) => setOwner({ ...owner, phone: e.target.value })}
                        />
                      </label>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2 sm:col-span-3">
                    <button type="submit" className="btn-primary" disabled={busy}>
                      {t('confirmButton')}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ol>
      {data.merchantOwner && !data.merchantOwner.isActive && me.canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-body-sm">
          <span>{t('ownerWaiting', { name: data.merchantOwner.name })}</span>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={async () => {
              const d = await act(`/sales/deals/${dealId}/setup-link`);
              if (d?.setupToken) setSetup(setupLink(origin, d.setupToken));
            }}
          >
            {t('newSetupLink')}
          </button>
        </div>
      )}
    </section>
  );
}
