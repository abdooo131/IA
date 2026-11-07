'use client';
import { useEffect } from 'react';
import { StatCard } from '@/parcels/components/StatCard';
import { Alert, Card, Loading, PageHeader } from '@/parcels/components/ui';
import {
  AlertsList,
  AttendanceBoard,
  type AlertRow,
  type ShiftRow,
  type Staff,
} from '@/parcels/components/workforce';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

interface Overview {
  agent: { id: string; code: string; name: string; supplies: string; commissionBp: number };
  date: string;
  pickupStaff: number;
  deliveryStaff: number;
  pending: number;
  vehicles: number;
  shifts: Record<string, number>;
  openAlerts: number;
  openRequests: number;
}

export default function AgentToday() {
  const t = useT();
  const ov = useLoad<Overview>('/agent/overview');
  const shifts = useLoad<{ date: string; shifts: ShiftRow[] }>('/agent/shifts');
  const staff = useLoad<Staff[]>('/agent/staff');
  const alerts = useLoad<AlertRow[]>('/agent/alerts');
  const reloadAll = () => {
    void ov.reload();
    void shifts.reload();
    void alerts.reload();
  };
  // Attendance changes by the minute: refresh while the page is open.
  useEffect(() => {
    const id = setInterval(reloadAll, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!ov.data || !shifts.data)
    return ov.error || shifts.error ? <Alert>{ov.error ?? shifts.error}</Alert> : <Loading />;
  const s = ov.data.shifts;
  const notIn = (s.SCHEDULED ?? 0) + (s.LATE_NOTICE ?? 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Agent code {code}', { code: ov.data.agent.code })}
        title={ov.data.agent.name}
        subtitle={t('Today, {date}', { date: ov.data.date })}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('Checked in')}
          value={String(s.CHECKED_IN ?? 0)}
          tone="delivered"
          icon="delivered"
        />
        <StatCard
          label={t('Not checked in yet')}
          value={String(notIn)}
          tone="needs-action"
          icon="schedule"
          alert={notIn > 0}
        />
        <StatCard
          label={t('Not coming')}
          value={String((s.NOT_COMING ?? 0) + (s.REPLACED ?? 0))}
          hint={t('{count} replaced', { count: s.REPLACED ?? 0 })}
          tone="returning"
          icon="alert"
        />
        <StatCard
          label={t('Waiting for approval')}
          value={String(ov.data.pending)}
          tone="new"
          icon="customers"
          alert={ov.data.pending > 0}
        />
      </div>
      <Card title={t('Open alerts ({count})', { count: alerts.data?.length ?? 0 })}>
        {alerts.data ? (
          <AlertsList base="/agent" alerts={alerts.data} onChange={reloadAll} />
        ) : (
          <Loading />
        )}
      </Card>
      <Card title={t('Attendance today')}>
        <AttendanceBoard
          shifts={shifts.data.shifts}
          staff={staff.data ?? []}
          answerBase="/agent"
          onChange={reloadAll}
        />
      </Card>
    </div>
  );
}
