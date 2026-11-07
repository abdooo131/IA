'use client';
import { Table, Td } from '@/components/ui';
import { egp } from '@/lib/format';
import { useT } from '@/lib/i18n';

export interface Preview {
  agent: { name: string; code: string };
  month: string;
  staffPay: number;
  commissionBp: number;
  commission: number;
  vehicleRent: number;
  specialVehicles: number;
  penalties: number;
  total: number;
  details: { perStaff: { courierId: string; name: string; work: number; other: number; parcels: number }[]; vehicles: { plate: string; rent: number }[]; special: { code: string; date: string; price: number }[]; overdueReplacements: number; penaltyEach: number };
}

export function SettlementBreakdown({ p }: { p: Preview }) {
  const t = useT();
  const line = (label: string, v: number, strong = false) => (
    <div className={`flex justify-between py-1 ${strong ? 'border-t border-line pt-2 font-bold' : ''}`}><span>{label}</span><span>{egp(v)}</span></div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="text-body-sm">
        {line(t('Staff pay (work, deductions, recharges)'), p.staffPay)}
        {line(t('Commission {pct}% of work', { pct: p.commissionBp / 100 }), p.commission)}
        {line(t('Fixed vehicle rent'), p.vehicleRent)}
        {line(t('Special vehicles'), p.specialVehicles)}
        {line(t('Late replacements ({count})', { count: p.details.overdueReplacements }), -p.penalties)}
        {line(t('Total'), p.total, true)}
      </div>
      <Table head={[t('Staff'), t('Parcels'), t('Work'), t('Other')]}>
        {p.details.perStaff.map((s) => (
          <tr key={s.courierId}><Td>{s.name}</Td><Td>{s.parcels}</Td><Td>{egp(s.work)}</Td><Td><span className={s.other < 0 ? 'text-danger' : ''}>{egp(s.other)}</span></Td></tr>
        ))}
      </Table>
    </div>
  );
}

