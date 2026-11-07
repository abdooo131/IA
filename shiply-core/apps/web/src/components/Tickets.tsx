'use client';
import { Badge } from '@/components/ui';
import { useT } from '@/lib/i18n';

export interface Ticket {
  id: string;
  code: string;
  kind: string;
  description: string;
  penalty: number;
  status: 'OPEN' | 'OVERRIDDEN' | 'CONFIRMED' | 'APPEALED' | 'UPHELD' | 'REVERSED';
  confirmAt: string;
  appealUntil: string | null;
  overrideReason: string;
  appealText: string;
  decisionNote: string;
  courierName: string;
  responsibleName: string;
  trackingNumber: string;
  hubCode: string;
  hasPhoto: boolean;
  createdAt: string;
}

export const TICKET_KIND: Record<string, string> = {
  DAMAGED: 'Damaged parcel',
  MISSING_PARCEL: 'Missing parcel',
  FAKE_ATTEMPT: 'Fake attempt',
  LATE_SCAN: 'Late scan',
  WRONG_SCAN: 'Wrong scan',
  CUSTOMER_COMPLAINT: 'Customer complaint',
  PALLET_DAMAGED: 'Pallet damaged',
  OTHER: 'Other',
};
const STATUS: Record<Ticket['status'], [string, 'amber' | 'slate' | 'red' | 'blue' | 'green']> = {
  OPEN: ['Waiting', 'amber'],
  OVERRIDDEN: ['Cancelled', 'slate'],
  CONFIRMED: ['Penalty applied', 'red'],
  APPEALED: ['Appealed', 'blue'],
  UPHELD: ['Appeal refused', 'red'],
  REVERSED: ['Reversed', 'green'],
};

export function TicketStatus({ status }: { status: Ticket['status'] }) {
  const t = useT();
  const [label, tone] = STATUS[status];
  return <Badge tone={tone}>{t(label)}</Badge>;
}
