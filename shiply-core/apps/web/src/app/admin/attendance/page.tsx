'use client';
import { useEffect, useState } from 'react';
import { StatCard } from '@/components/StatCard';
import { Alert, Button, Card, Input, Loading, PageHeader, Select } from '@/components/ui';
import { AttendanceBoard, type ShiftRow } from '@/components/workforce';
import { api, errorMessage } from '@/lib/api';
import { todayCairo } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

export default function AttendancePage() {
  const t = useT();
  const [date, setDate] = useState(todayCairo());
  const [agentId, setAgentId] = useState('');
  const agents = useLoad<{ id: string; name: string }[]>('/admin/agents');
  const board = useLoad<{ date: string; shifts: ShiftRow[] }>(`/admin/attendance?date=${date}${agentId ? `&agentId=${agentId}` : ''}`);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => void board.reload(), 60_000);
    return () => clearInterval(id);
  }, [board.reload]);

  const runCheck = async () => {
    setError(null);
    try {
      await api('/admin/jobs/attendance', { body: {} });
      await board.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const shifts = board.data?.shifts ?? [];
  const count = (st: ShiftRow['status'][]) => shifts.filter((s) => st.includes(s.status)).length;
  const overdue = shifts.filter((s) => s.replacementOverdue && !s.replacementShiftId).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('Workforce')}
        title={t('Attendance')}
        subtitle={t('Who checked in, who is late, and replacements still owed by agents')}
        actions={<Button tone="secondary" onClick={() => void runCheck()}>{t('Check now')}</Button>}
      />
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ltr-iso w-44" />
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">{t('All agents')}</option>
          {(agents.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('Checked in')} value={String(count(['CHECKED_IN']))} tone="delivered" icon="delivered" />
        <StatCard label={t('Not checked in yet')} value={String(count(['SCHEDULED', 'LATE_NOTICE']))} tone="needs-action" icon="schedule" />
        <StatCard label={t('Not coming')} value={String(count(['NOT_COMING', 'REPLACED']))} hint={t('{count} replaced', { count: count(['REPLACED']) })} tone="returning" icon="alert" />
        <StatCard label={t('Replacement overdue')} value={String(overdue)} tone="needs-action" icon="alert" alert={overdue > 0} />
      </div>
      <Card title={t('Shifts on {date}', { date })}>
        {board.error ? <Alert>{board.error}</Alert> : board.data ? <AttendanceBoard shifts={shifts} photoBase="/admin/attendance" showAgent /> : <Loading />}
      </Card>
    </div>
  );
}
