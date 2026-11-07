'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Td } from '@/parcels/components/ui';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';
import { AgentForm, SUPPLIES_LABEL, type AgentProfile } from './AgentForm';

type Row = AgentProfile & { pickupStaff: number; deliveryStaff: number; _count: { vehicles: number; documents: number } };

export default function AgentsPage() {
  const t = useT();
  const router = useRouter();
  const agents = useLoad<Row[]>('/admin/agents');
  const [creating, setCreating] = useState(false);
  if (!agents.data) return agents.error ? <Alert>{agents.error}</Alert> : <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('Agents')} subtitle={t('Companies that supply pickup and delivery staff and vehicles')} actions={<Button onClick={() => setCreating((c) => !c)}>{creating ? t('Close') : t('Add agent')}</Button>} />
      {creating && (
        <Card title={t('New agent')}>
          <AgentForm agent={null} onSaved={(a) => router.push(`/parcels/admin/agents/${a.id}`)} />
        </Card>
      )}
      <Card title={t('{count} agents', { count: agents.data.length })}>
        {agents.data.length === 0 ? (
          <Empty>{t('No agents yet')}</Empty>
        ) : (
          <Table head={[t('Agent'), t('Code'), t('Supplies'), t('Staff'), t('Vehicles'), t('Commission'), t('Status')]}>
            {agents.data.map((a) => (
              <tr key={a.id}>
                <Td>
                  <Link href={`/parcels/admin/agents/${a.id}`} className="font-bold text-link">{a.name}</Link>
                  <div className="ltr-iso text-caption text-text-muted">{a.phone}</div>
                </Td>
                <Td><span className="ltr-iso font-bold">{a.code}</span></Td>
                <Td>{t(SUPPLIES_LABEL[a.supplies])}</Td>
                <Td>{t('{pickup} pickup · {delivery} delivery', { pickup: a.pickupStaff, delivery: a.deliveryStaff })}</Td>
                <Td>{a._count.vehicles}</Td>
                <Td><span className="ltr-iso">{a.effectiveCommissionBp / 100}%</span>{a.commissionBp == null && <span className="ms-1 text-caption text-text-muted">{t('default')}</span>}</Td>
                <Td>{a.active ? <Badge tone="green">{t('Active')}</Badge> : <Badge tone="red">{t('Inactive')}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
