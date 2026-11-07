'use client';
import { useMe } from '@/parcels/components/Shell';
import { Alert, Loading, PageHeader } from '@/parcels/components/ui';
import { StaffPanel } from '@/parcels/components/workforce';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

export default function AgentStaff() {
  const t = useT();
  const me = useMe();
  const ov = useLoad<{ agent: { code: string; supplies: string } }>('/agent/overview');
  if (!ov.data) return ov.error ? <Alert>{ov.error}</Alert> : <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={me.agent?.name} title={t('Staff')} subtitle={t('Approve new staff, choose their hub, shift and work days')} />
      <StaffPanel base="/agent" supplies={ov.data.agent.supplies} joinCode={ov.data.agent.code} />
    </div>
  );
}
