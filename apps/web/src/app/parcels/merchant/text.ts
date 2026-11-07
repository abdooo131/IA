'use client';
import { FAIL_REASONS, FAIL_REASON_LABELS_AR, STATUS_LABELS_AR, type FailReason, type ShipmentStatus } from '@shiplynow/shared/parcels';
import { useCallback } from 'react';
import { statusLabel } from '@/parcels/lib/format';
import { useLocale } from '@/parcels/lib/i18n';

/** Status and failure reason words in the current language. */
export function useStatusText() {
  const locale = useLocale();
  return useCallback(
    (status: string) => (locale === 'ar' ? STATUS_LABELS_AR[status as ShipmentStatus] ?? status : statusLabel(status)),
    [locale],
  );
}

export function useReasonText() {
  const locale = useLocale();
  return useCallback(
    (reason: string | null | undefined) => {
      if (!reason) return '';
      if (locale === 'ar') return FAIL_REASON_LABELS_AR[reason as FailReason] ?? reason;
      return FAIL_REASONS[reason as FailReason]?.label ?? reason;
    },
    [locale],
  );
}
