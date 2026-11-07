'use client';
import { useState } from 'react';
import { Alert, Card, Loading, PageHeader, Select } from '@/components/ui';
import { AlertsList, type AlertRow } from '@/components/workforce';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

export default function AlertsPage() {
  const t = useT();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const alerts = useLoad<AlertRow[]>(`/admin/alerts?status=${status}`);
  const high = (alerts.data ?? []).filter((a) => a.severity === 'high');
  const rest = (alerts.data ?? []).filter((a) => a.severity !== 'high');
  return (
    <div className="space-y-5">
      <PageHeader
       
        title={t('Alerts')}
        subtitle={t('Attendance, approvals and vehicle requests that need someone to act')}
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'OPEN' | 'RESOLVED')}>
            <option value="OPEN">{t('Open')}</option>
            <option value="RESOLVED">{t('Done')}</option>
          </Select>
        }
      />
      {alerts.error && <Alert>{alerts.error}</Alert>}
      {!alerts.data ? (
        <Loading />
      ) : (
        <>
          {high.length > 0 && (
            <Card title={t('Urgent ({count})', { count: high.length })}>
              <AlertsList base="/admin" alerts={high} onChange={() => void alerts.reload()} />
            </Card>
          )}
          <Card title={t('{count} alerts', { count: rest.length })}>
            <AlertsList base="/admin" alerts={rest} onChange={() => void alerts.reload()} />
          </Card>
        </>
      )}
    </div>
  );
}
