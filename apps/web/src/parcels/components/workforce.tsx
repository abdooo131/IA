'use client';
// Pieces shared by the admin workforce pages and the agent portal: staff, vehicles,
// attendance, alerts and special vehicle requests. `base` is the API path that owns them
// ('/agent' for the agent, '/admin/agents/<id>' for operations).
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Select,
  Table,
  Td,
} from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { dateTime, egp } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useLocale, useT } from '@/parcels/lib/i18n';

export interface Staff {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  courierType: 'PICKUP' | 'DELIVERY' | null;
  hubId: string | null;
  hubToHub: boolean;
  shiftStart: string;
  workDays: number[];
  vehicleId: string | null;
  pendingApproval: boolean;
  active: boolean;
  hub: { code: string; name: string } | null;
  vehicle: { plate: string } | null;
  areas: { areaId: string }[];
}

export interface Vehicle {
  id: string;
  plate: string;
  kind: string;
  contract: 'FIXED' | 'SPECIAL';
  monthlyRent: number;
  capacityParcels: number | null;
  active: boolean;
  users: { id: string; name: string }[];
}

export interface ShiftRow {
  id: string;
  date: string;
  startAt: string;
  status: 'SCHEDULED' | 'CHECKED_IN' | 'LATE_NOTICE' | 'NOT_COMING' | 'REPLACED';
  checkInAt: string | null;
  lateMinutes: number;
  alertedAt: string | null;
  expectedAt: string | null;
  replacementDeadline: string | null;
  replacementOverdue: boolean;
  replacementShiftId: string | null;
  replacesShiftId: string | null;
  agentId: string;
  courier: {
    id: string;
    name: string;
    phone: string;
    courierType: string | null;
    hub: { code: string } | null;
  };
  agent: { name: string };
}

export interface AlertRow {
  id: string;
  kind: string;
  severity: 'normal' | 'high';
  message: string;
  entity: string;
  entityId: string;
  agentId: string | null;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  agentName: string | null;
  subject: string | null;
  date: string | null;
  deadline: string | null;
}

/** The alert sentence, worded on the screen so it follows the chosen language. */
const ALERT_TEXT: Record<string, string> = {
  STAFF_WAITING_APPROVAL: '{name} joined with your code and is waiting for approval',
  VEHICLE_REQUESTED: 'Operations asked for a vehicle with driver on {date} ({name})',
  NOT_CHECKED_IN: '{name} has not checked in yet. Late or not coming?',
  LATE_STILL_MISSING: '{name} said late but has still not checked in',
  REPLACEMENT_NEEDED: 'Send a replacement for {name} before {time}',
  REPLACEMENT_OVERDUE: '{agent} did not send a replacement for {name} in time',
};

export interface VehicleRequestRow {
  id: string;
  code: string;
  reason: string;
  date: string;
  price: number;
  status: 'REQUESTED' | 'PROVIDED' | 'DONE' | 'CANCELLED';
  driverName: string | null;
  driverPhone: string | null;
  notes: string;
  vehicle: { plate: string } | null;
  agent: { name: string; code: string };
  createdAt: string;
}

interface HubRef {
  id: string;
  code: string;
  name: string;
  isSorting: boolean;
}
interface Gov {
  code: string;
  nameEn: string;
  nameAr: string;
  hubId: string | null;
  areas: { id: string; nameEn: string; nameAr: string; hubId: string | null }[];
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TYPE_LABEL: Record<string, string> = { PICKUP: 'Pickup', DELIVERY: 'Delivery' };
export const SHIFT_LABEL: Record<ShiftRow['status'], string> = {
  SCHEDULED: 'Not checked in',
  CHECKED_IN: 'Checked in',
  LATE_NOTICE: 'Running late',
  NOT_COMING: 'Not coming',
  REPLACED: 'Replaced',
};
const SHIFT_TONE: Record<ShiftRow['status'], 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  SCHEDULED: 'slate',
  CHECKED_IN: 'green',
  LATE_NOTICE: 'amber',
  NOT_COMING: 'red',
  REPLACED: 'blue',
};
export const ALERT_LABEL: Record<string, string> = {
  STAFF_WAITING_APPROVAL: 'Waiting for approval',
  VEHICLE_REQUESTED: 'Vehicle requested',
  NOT_CHECKED_IN: 'Not checked in',
  LATE_STILL_MISSING: 'Late and still missing',
  REPLACEMENT_NEEDED: 'Replacement needed',
  REPLACEMENT_OVERDUE: 'Replacement overdue',
  CASH_LIMIT_COURIER: 'Courier over cash limit',
  CASH_LIMIT_SAFE: 'Safe over cash limit',
  PARCEL_IN_SEARCH: 'Parcel in search',
  PARCEL_DAMAGED: 'Parcel damaged',
  PALLET_DAMAGED: 'Pallet damaged',
  CUTOFF_MISSED: 'Missed the cutoff',
  QC_TICKET: 'Quality ticket',
  QC_PENALTY: 'Penalty applied',
  QC_APPEAL: 'Appeal to decide',
  FRAUD_FAILED_SPIKE: 'Fraud check: many failures',
  FRAUD_QUICK_FAILS: 'Fraud check: quick failures',
  FRAUD_REPEAT_REFUSER: 'Fraud check: repeat refuser',
  FRAUD_CASH_SHORT: 'Fraud check: cash shortages',
};
export const VEHICLE_KIND: Record<string, string> = {
  VAN: 'Van',
  BOX_TRUCK: 'Box truck',
  PICKUP_TRUCK: 'Pickup truck',
  CAR: 'Car',
  MOTORCYCLE: 'Motorcycle',
};
export const REQUEST_REASON: Record<string, string> = {
  MERCHANT_SPECIAL: 'Merchant special pickup',
  BREAKDOWN: 'Vehicle broke down',
  VEHICLE_FULL: 'Vehicle full',
  OTHER: 'Other',
};
const REQUEST_TONE: Record<VehicleRequestRow['status'], 'amber' | 'blue' | 'green' | 'slate'> = {
  REQUESTED: 'amber',
  PROVIDED: 'blue',
  DONE: 'green',
  CANCELLED: 'slate',
};
export const REQUEST_STATUS: Record<VehicleRequestRow['status'], string> = {
  REQUESTED: 'Requested',
  PROVIDED: 'Provided',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

/** Time in Cairo, HH:MM. */
export function clock(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null;
}

// ------------------------------------------------------------------ staff

type StaffForm = {
  name: string;
  phone: string;
  password: string;
  courierType: 'PICKUP' | 'DELIVERY';
  hubId: string;
  hubToHub: boolean;
  shiftStart: string;
  workDays: number[];
  vehicleId: string;
  areaIds: string[];
  active: boolean;
};

function toForm(s: Staff | null, supplies: string): StaffForm {
  return {
    name: s?.name ?? '',
    phone: s?.phone ?? '',
    password: '',
    courierType: s?.courierType ?? (supplies === 'DELIVERY' ? 'DELIVERY' : 'PICKUP'),
    hubId: s?.hubId ?? '',
    hubToHub: s?.hubToHub ?? false,
    shiftStart: s?.shiftStart ?? '09:00',
    workDays: s?.workDays ?? [0, 1, 2, 3, 4, 6],
    vehicleId: s?.vehicleId ?? '',
    areaIds: s?.areas.map((a) => a.areaId) ?? [],
    active: s ? s.active || s.pendingApproval : true,
  };
}

function StaffEditor({
  base,
  supplies,
  staff,
  vehicles,
  onDone,
  onCancel,
}: {
  base: string;
  supplies: string;
  staff: Staff | null;
  vehicles: Vehicle[];
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const hubs = useLoad<HubRef[]>('/reference/hubs');
  const locations = useLoad<Gov[]>('/reference/locations');
  const [f, setF] = useState<StaffForm>(() => toForm(staff, supplies));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hubChoices = (hubs.data ?? []).filter((h) =>
    f.courierType === 'PICKUP' ? h.isSorting : !h.isSorting,
  );
  const areas = useMemo(
    () =>
      (locations.data ?? []).flatMap((g) =>
        g.areas
          .filter((a) => f.hubId && a.hubId === f.hubId)
          .map((a) => ({ id: a.id, name: locale === 'ar' ? a.nameAr : a.nameEn })),
      ),
    [locations.data, f.hubId, locale],
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: f.name,
        phone: f.phone,
        courierType: f.courierType,
        hubId: f.hubId || null,
        hubToHub: f.courierType === 'PICKUP' && f.hubToHub,
        shiftStart: f.shiftStart,
        workDays: f.workDays,
        vehicleId: f.courierType === 'PICKUP' && f.vehicleId ? f.vehicleId : null,
        areaIds: f.areaIds.filter((id) => areas.some((a) => a.id === id)),
        active: f.active,
        ...(f.password ? { password: f.password } : {}),
      };
      if (staff) await api(`${base}/staff/${staff.id}`, { method: 'PUT', body });
      else await api(`${base}/staff`, { body });
      onDone(
        staff?.pendingApproval && f.hubId
          ? t('{name} is approved', { name: f.name })
          : t('Saved {name}', { name: f.name }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const toggleDay = (d: number) =>
    setF({
      ...f,
      workDays: f.workDays.includes(d)
        ? f.workDays.filter((x) => x !== d)
        : [...f.workDays, d].sort(),
    });
  const toggleArea = (id: string) =>
    setF({
      ...f,
      areaIds: f.areaIds.includes(id) ? f.areaIds.filter((x) => x !== id) : [...f.areaIds, id],
    });

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-surface-raised p-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('Name')}>
          <Input
            required
            minLength={2}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label={t('Phone')}>
          <Input
            required
            inputMode="tel"
            className="ltr-iso"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </Field>
        <Field
          label={t('Password')}
          hint={staff ? t('Leave empty to keep the current password') : t('8 characters or more')}
        >
          <Input
            type="password"
            minLength={8}
            required={!staff}
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
        </Field>
        <Field label={t('Works as')}>
          <Select
            value={f.courierType}
            disabled={supplies !== 'BOTH'}
            onChange={(e) =>
              setF({
                ...f,
                courierType: e.target.value as StaffForm['courierType'],
                hubId: '',
                vehicleId: '',
                areaIds: [],
              })
            }
          >
            <option value="PICKUP">{t('Pickup')}</option>
            <option value="DELIVERY">{t('Delivery')}</option>
          </Select>
        </Field>
        <Field
          label={t('Hub')}
          hint={
            f.courierType === 'PICKUP'
              ? t('Pickup staff work from a sorting facility')
              : t('Delivery staff work from a last mile hub')
          }
        >
          <Select
            value={f.hubId}
            onChange={(e) => setF({ ...f, hubId: e.target.value, areaIds: [] })}
          >
            <option value="">{t('Not assigned yet')}</option>
            {hubChoices.map((h) => (
              <option key={h.id} value={h.id}>
                {h.code} · {h.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Shift starts')}>
          <Input
            type="time"
            required
            value={f.shiftStart}
            onChange={(e) => setF({ ...f, shiftStart: e.target.value })}
            className="ltr-iso"
          />
        </Field>
        {f.courierType === 'PICKUP' && (
          <Field label={t('Vehicle')}>
            <Select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
              <option value="">{t('No vehicle')}</option>
              {vehicles
                .filter((v) => v.active)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} · {t(VEHICLE_KIND[v.kind] ?? v.kind)}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label={t('Work days')}>
        <div className="flex flex-wrap gap-2">
          {DAY_NAMES.map((d, i) => (
            <label
              key={d}
              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm ${f.workDays.includes(i) ? 'border-accent bg-selected-bg font-bold' : 'border-line'}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={f.workDays.includes(i)}
                onChange={() => toggleDay(i)}
              />
              {t(d)}
            </label>
          ))}
        </div>
      </Field>
      {areas.length > 0 && (
        <Field label={t('Areas they cover')} hint={t('Leave empty to cover the whole hub')}>
          <div className="flex flex-wrap gap-2">
            {areas.map((a) => (
              <label
                key={a.id}
                className={`flex min-h-9 cursor-pointer items-center rounded-md border px-3 text-body-sm ${f.areaIds.includes(a.id) ? 'border-accent bg-selected-bg font-bold' : 'border-line'}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={f.areaIds.includes(a.id)}
                  onChange={() => toggleArea(a.id)}
                />
                {a.name}
              </label>
            ))}
          </div>
        </Field>
      )}
      <div className="flex flex-wrap gap-4">
        {f.courierType === 'PICKUP' && (
          <label className="flex items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={f.hubToHub}
              onChange={(e) => setF({ ...f, hubToHub: e.target.checked })}
            />
            {t('Also drives hub to hub')}
          </label>
        )}
        {staff && !staff.pendingApproval && (
          <label className="flex items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={f.active}
              onChange={(e) => setF({ ...f, active: e.target.checked })}
            />
            {t('Active')}
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {staff?.pendingApproval ? (f.hubId ? t('Approve') : t('Save')) : t('Save')}
        </Button>
        <Button type="button" tone="ghost" onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}

export function StaffPanel({
  base,
  supplies,
  joinCode,
}: {
  base: string;
  supplies: string;
  joinCode?: string;
}) {
  const t = useT();
  const staff = useLoad<Staff[]>(`${base}/staff`);
  const vehicles = useLoad<Vehicle[]>(`${base}/vehicles`);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const list = (staff.data ?? []).filter(
    (s) => !filter || (filter === 'PENDING' ? s.pendingApproval : s.courierType === filter),
  );
  const pending = (staff.data ?? []).filter((s) => s.pendingApproval).length;

  const done = async (text: string) => {
    setEditing(null);
    setMsg({ ok: true, text });
    await staff.reload();
  };

  return (
    <Card
      title={t('{count} staff', { count: staff.data?.length ?? 0 })}
      actions={
        <div className="flex gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t('Everyone')}</option>
            <option value="PENDING">
              {t('Waiting for approval ({count})', { count: pending })}
            </option>
            <option value="PICKUP">{t('Pickup')}</option>
            <option value="DELIVERY">{t('Delivery')}</option>
          </Select>
          <Button
            className="whitespace-nowrap"
            onClick={() => setEditing(editing === 'new' ? null : 'new')}
          >
            {editing === 'new' ? t('Close') : t('Add staff')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {joinCode && (
          <p className="text-body-sm text-text-muted">
            {t('Staff can also register themselves on the join page with the code')}{' '}
            <span className="ltr-iso font-bold text-text">{joinCode}</span>
          </p>
        )}
        <Msg msg={msg} />
        {staff.error && <Alert>{staff.error}</Alert>}
        {editing === 'new' && (
          <StaffEditor
            base={base}
            supplies={supplies}
            staff={null}
            vehicles={vehicles.data ?? []}
            onDone={done}
            onCancel={() => setEditing(null)}
          />
        )}
        {staff.data && list.length === 0 && <Empty>{t('No staff yet')}</Empty>}
        {list.length > 0 && (
          <Table head={[t('Name'), t('Works as'), t('Hub'), t('Shift'), t('Status'), '']}>
            {list.map((s) =>
              editing === s.id ? (
                <tr key={s.id}>
                  <td colSpan={6} className="p-2">
                    <StaffEditor
                      base={base}
                      supplies={supplies}
                      staff={s}
                      vehicles={vehicles.data ?? []}
                      onDone={done}
                      onCancel={() => setEditing(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={s.id}>
                  <Td>
                    {s.name}
                    <div className="ltr-iso text-caption text-text-muted">{s.phone}</div>
                  </Td>
                  <Td>
                    {s.courierType ? t(TYPE_LABEL[s.courierType]!) : ''}
                    {s.hubToHub && <div className="text-caption text-link">{t('Hub to hub')}</div>}
                    {s.vehicle && (
                      <div className="ltr-iso text-caption text-text-muted">{s.vehicle.plate}</div>
                    )}
                  </Td>
                  <Td>
                    <span className="ltr-iso">{s.hub?.code ?? ''}</span>
                  </Td>
                  <Td>
                    <span className="ltr-iso">{s.shiftStart}</span>
                    <div className="text-caption text-text-muted">
                      {s.workDays.map((d) => t(DAY_NAMES[d]!)).join(' ')}
                    </div>
                  </Td>
                  <Td>
                    {s.pendingApproval ? (
                      <Badge tone="amber">{t('Waiting for approval')}</Badge>
                    ) : s.active ? (
                      <Badge tone="green">{t('Active')}</Badge>
                    ) : (
                      <Badge tone="red">{t('Inactive')}</Badge>
                    )}
                  </Td>
                  <Td>
                    <Button
                      tone={s.pendingApproval ? 'primary' : 'ghost'}
                      onClick={() => setEditing(s.id)}
                    >
                      {s.pendingApproval ? t('Review') : t('Edit')}
                    </Button>
                  </Td>
                </tr>
              ),
            )}
          </Table>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ vehicles

const emptyVehicle = {
  plate: '',
  kind: 'VAN',
  contract: 'FIXED' as 'FIXED' | 'SPECIAL',
  rent: '',
  capacity: '',
  active: true,
};

export function VehiclesPanel({ base }: { base: string }) {
  const t = useT();
  const vehicles = useLoad<Vehicle[]>(`${base}/vehicles`);
  const [editing, setEditing] = useState<string | null>(null);
  const [f, setF] = useState(emptyVehicle);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const open = (v: Vehicle | null) => {
    setEditing(v?.id ?? 'new');
    setF(
      v
        ? {
            plate: v.plate,
            kind: v.kind,
            contract: v.contract,
            rent: v.monthlyRent ? String(v.monthlyRent / 100) : '',
            capacity: v.capacityParcels ? String(v.capacityParcels) : '',
            active: v.active,
          }
        : emptyVehicle,
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const body = {
        plate: f.plate,
        kind: f.kind,
        contract: f.contract,
        monthlyRent: Math.round(Number(f.rent || 0) * 100),
        capacityParcels: f.capacity ? Number(f.capacity) : null,
        active: f.active,
      };
      if (editing === 'new') await api(`${base}/vehicles`, { body });
      else await api(`${base}/vehicles/${editing}`, { method: 'PUT', body });
      setMsg({ ok: true, text: t('Saved {name}', { name: f.plate }) });
      setEditing(null);
      await vehicles.reload();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  return (
    <Card
      title={t('Vehicles')}
      actions={
        <Button onClick={() => (editing ? setEditing(null) : open(null))}>
          {editing ? t('Close') : t('Add vehicle')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Msg msg={msg} />
        {editing && (
          <form
            onSubmit={save}
            className="grid gap-3 rounded-lg border border-line bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Field label={t('Plate')}>
              <Input
                required
                value={f.plate}
                onChange={(e) => setF({ ...f, plate: e.target.value })}
              />
            </Field>
            <Field label={t('Kind')}>
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {Object.entries(VEHICLE_KIND).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('Contract')}
              hint={t('Fixed vehicles are paid monthly; special ones per request')}
            >
              <Select
                value={f.contract}
                onChange={(e) => setF({ ...f, contract: e.target.value as 'FIXED' | 'SPECIAL' })}
              >
                <option value="FIXED">{t('Fixed')}</option>
                <option value="SPECIAL">{t('Special')}</option>
              </Select>
            </Field>
            {f.contract === 'FIXED' && (
              <Field label={t('Monthly rent (EGP)')}>
                <Input
                  inputMode="decimal"
                  className="ltr-iso"
                  value={f.rent}
                  onChange={(e) => setF({ ...f, rent: e.target.value })}
                />
              </Field>
            )}
            <Field label={t('Capacity (parcels)')}>
              <Input
                inputMode="numeric"
                className="ltr-iso"
                value={f.capacity}
                onChange={(e) => setF({ ...f, capacity: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 self-end text-body-sm">
              <input
                type="checkbox"
                checked={f.active}
                onChange={(e) => setF({ ...f, active: e.target.checked })}
              />
              {t('Active')}
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit">{t('Save')}</Button>
            </div>
          </form>
        )}
        {vehicles.data && vehicles.data.length === 0 && <Empty>{t('No vehicles yet')}</Empty>}
        {vehicles.data && vehicles.data.length > 0 && (
          <Table head={[t('Plate'), t('Kind'), t('Contract'), t('Capacity'), t('Driven by'), '']}>
            {vehicles.data.map((v) => (
              <tr key={v.id}>
                <Td>
                  <span className="ltr-iso font-bold">{v.plate}</span>
                  {!v.active && (
                    <span className="ms-2">
                      <Badge tone="red">{t('Inactive')}</Badge>
                    </span>
                  )}
                </Td>
                <Td>{t(VEHICLE_KIND[v.kind] ?? v.kind)}</Td>
                <Td>
                  {v.contract === 'FIXED' ? `${t('Fixed')} · ${egp(v.monthlyRent)}` : t('Special')}
                </Td>
                <Td>{v.capacityParcels ?? ''}</Td>
                <Td>{v.users.map((u) => u.name).join(', ')}</Td>
                <Td>
                  <Button tone="ghost" onClick={() => open(v)}>
                    {t('Edit')}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ attendance

function Countdown({ until }: { until: string }) {
  const t = useT();
  const mins = Math.round((new Date(until).getTime() - Date.now()) / 60000);
  return mins >= 0 ? (
    <Badge tone="amber">{t('{count} min left', { count: mins })}</Badge>
  ) : (
    <Badge tone="red">{t('Overdue by {count} min', { count: -mins })}</Badge>
  );
}

/**
 * Today's shifts. With `answerBase` (the agent portal) each missing person can be marked late or
 * not coming, and a replacement can be sent. Without it the board is read only (operations).
 */
export function AttendanceBoard({
  shifts,
  staff,
  answerBase,
  photoBase,
  onChange,
  showAgent,
}: {
  shifts: ShiftRow[];
  staff?: Staff[];
  answerBase?: string;
  photoBase?: string;
  onChange?: () => void;
  showAgent?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lateFor, setLateFor] = useState<string | null>(null);
  const [lateTime, setLateTime] = useState('10:00');
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');

  const act = async (path: string, body: unknown, ok: string) => {
    setMsg(null);
    try {
      await api(`${answerBase}${path}`, { body });
      setMsg({ ok: true, text: ok });
      setLateFor(null);
      setReplaceFor(null);
      onChange?.();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  const busyToday = new Set(
    shifts
      .filter((s) => s.status !== 'NOT_COMING' && s.status !== 'REPLACED')
      .map((s) => s.courier.id),
  );
  const now = Date.now();

  if (shifts.length === 0) return <Empty>{t('No shifts today')}</Empty>;
  return (
    <div className="space-y-3">
      <Msg msg={msg} />
      <Table
        head={[
          t('Name'),
          ...(showAgent ? [t('Agent')] : []),
          t('Starts'),
          t('Status'),
          t('Checked in'),
          '',
        ]}
      >
        {shifts.map((s) => {
          const missing =
            !s.checkInAt &&
            (s.status === 'SCHEDULED' || s.status === 'LATE_NOTICE') &&
            new Date(s.startAt).getTime() < now;
          const candidates = (staff ?? []).filter(
            (p) =>
              p.active &&
              p.courierType === s.courier.courierType &&
              p.id !== s.courier.id &&
              !busyToday.has(p.id),
          );
          return (
            <tr
              key={s.id}
              className={s.replacementOverdue && !s.replacementShiftId ? 'bg-danger/10' : undefined}
            >
              <Td>
                {s.courier.name}
                <div className="text-caption text-text-muted">
                  {s.courier.courierType ? t(TYPE_LABEL[s.courier.courierType]!) : ''}{' '}
                  <span className="ltr-iso">{s.courier.hub?.code ?? ''}</span>
                  {s.replacesShiftId && (
                    <span className="ms-1 font-bold text-link">{t('Replacement')}</span>
                  )}
                </div>
              </Td>
              {showAgent && <Td>{s.agent.name}</Td>}
              <Td>
                <span className="ltr-iso">{clock(s.startAt, locale)}</span>
              </Td>
              <Td>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={missing && s.status === 'SCHEDULED' ? 'red' : SHIFT_TONE[s.status]}>
                    {t(SHIFT_LABEL[s.status])}
                  </Badge>
                  {s.status === 'LATE_NOTICE' && s.expectedAt && (
                    <span className="text-caption">
                      {t('expected {time}', { time: clock(s.expectedAt, locale) })}
                    </span>
                  )}
                  {s.status === 'NOT_COMING' && !s.replacementShiftId && s.replacementDeadline && (
                    <Countdown until={s.replacementDeadline} />
                  )}
                </div>
              </Td>
              <Td>
                {s.checkInAt ? (
                  <span>
                    <span className="ltr-iso">{clock(s.checkInAt, locale)}</span>
                    {s.lateMinutes > 0 && (
                      <span className="ms-1 text-caption text-text-muted">
                        {t('{count} min late', { count: s.lateMinutes })}
                      </span>
                    )}
                    {photoBase && (
                      <a
                        className="ms-2 text-caption font-bold text-link"
                        href={`/api/parcels${photoBase}/${s.id}/photo`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('Photo')}
                      </a>
                    )}
                  </span>
                ) : (
                  ''
                )}
              </Td>
              <Td>
                {answerBase && missing && (
                  <div className="flex flex-wrap gap-1">
                    {lateFor === s.id ? (
                      <span className="flex items-center gap-1">
                        <Input
                          type="time"
                          value={lateTime}
                          onChange={(e) => setLateTime(e.target.value)}
                          className="ltr-iso w-28"
                        />
                        <Button
                          onClick={() =>
                            act(
                              `/shifts/${s.id}/answer`,
                              { answer: 'LATE', expectedTime: lateTime },
                              t('{name} marked late', { name: s.courier.name }),
                            )
                          }
                        >
                          {t('Save')}
                        </Button>
                      </span>
                    ) : (
                      <Button tone="secondary" onClick={() => setLateFor(s.id)}>
                        {t('Running late')}
                      </Button>
                    )}
                    <Button
                      tone="ghost"
                      onClick={() =>
                        act(
                          `/shifts/${s.id}/answer`,
                          { answer: 'NOT_COMING' },
                          t('Send a replacement for {name}', { name: s.courier.name }),
                        )
                      }
                    >
                      {t('Not coming')}
                    </Button>
                  </div>
                )}
                {answerBase &&
                  s.status === 'NOT_COMING' &&
                  !s.replacementShiftId &&
                  (replaceFor === s.id ? (
                    <span className="flex items-center gap-1">
                      <Select value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                        <option value="">{t('Choose a person')}</option>
                        {candidates.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.hub ? `· ${p.hub.code}` : ''}
                          </option>
                        ))}
                      </Select>
                      <Button
                        disabled={!replacement}
                        onClick={() =>
                          act(
                            `/shifts/${s.id}/replacement`,
                            { courierId: replacement },
                            t('Replacement sent'),
                          )
                        }
                      >
                        {t('Send')}
                      </Button>
                      {candidates.length === 0 && (
                        <span className="text-caption text-text-muted">
                          {t('Everyone else works today. Add or approve someone on the Staff page')}
                        </span>
                      )}
                    </span>
                  ) : (
                    <Button
                      onClick={() => {
                        setReplaceFor(s.id);
                        setReplacement('');
                      }}
                    >
                      {t('Send replacement')}
                    </Button>
                  ))}
              </Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

// ------------------------------------------------------------------ alerts

export function AlertsList({
  base,
  alerts,
  onChange,
}: {
  base: string;
  alerts: AlertRow[];
  onChange: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const resolve = async (a: AlertRow) => {
    const note = window.prompt(t('What was done? (optional)')) ?? '';
    try {
      await api(`${base}/alerts/${a.id}/resolve`, { body: { note } });
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  if (alerts.length === 0) return <Empty>{t('No open alerts')}</Empty>;
  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-line">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone={a.severity === 'high' ? 'red' : 'amber'}>
                  {t(ALERT_LABEL[a.kind] ?? a.kind)}
                </Badge>
                <span className="text-caption text-text-muted">{dateTime(a.createdAt)}</span>
              </div>
              <p className="mt-1 text-body-sm">
                {ALERT_TEXT[a.kind] && a.subject
                  ? t(ALERT_TEXT[a.kind]!, {
                      name: a.subject,
                      agent: a.agentName ?? '',
                      date: a.date ?? '',
                      time: clock(a.deadline, locale),
                    })
                  : a.message}
              </p>
            </div>
            {a.status === 'OPEN' && (
              <Button tone="ghost" onClick={() => void resolve(a)}>
                {t('Mark done')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ vehicle requests

export function VehicleRequestsTable({
  rows,
  vehicles,
  provideBase,
  closeBase,
  onChange,
  showAgent,
}: {
  rows: VehicleRequestRow[];
  vehicles?: Vehicle[];
  provideBase?: string;
  closeBase?: string;
  onChange: () => void;
  showAgent?: boolean;
}) {
  const t = useT();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [providing, setProviding] = useState<string | null>(null);
  const [p, setP] = useState({ vehicleId: '', driverName: '', driverPhone: '' });

  const call = async (path: string, body: unknown, ok: string) => {
    setMsg(null);
    try {
      await api(path, { body });
      setMsg({ ok: true, text: ok });
      setProviding(null);
      onChange();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  };

  if (rows.length === 0) return <Empty>{t('No vehicle requests')}</Empty>;
  return (
    <div className="space-y-3">
      <Msg msg={msg} />
      <Table
        head={[
          t('Request'),
          ...(showAgent ? [t('Agent')] : []),
          t('Date'),
          t('Price'),
          t('Status'),
          t('Driver'),
          '',
        ]}
      >
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>
              <span className="ltr-iso font-bold">{r.code}</span>
              <div className="text-caption text-text-muted">
                {t(REQUEST_REASON[r.reason] ?? r.reason)}
              </div>
              {r.notes && <div className="text-caption">{r.notes}</div>}
            </Td>
            {showAgent && <Td>{r.agent.name}</Td>}
            <Td>
              <span className="ltr-iso">{r.date}</span>
            </Td>
            <Td>{egp(r.price)}</Td>
            <Td>
              <Badge tone={REQUEST_TONE[r.status]}>{t(REQUEST_STATUS[r.status])}</Badge>
            </Td>
            <Td>
              {r.driverName ?? ''}
              {r.driverPhone && (
                <div className="ltr-iso text-caption text-text-muted">{r.driverPhone}</div>
              )}
              {r.vehicle && (
                <div className="ltr-iso text-caption text-text-muted">{r.vehicle.plate}</div>
              )}
            </Td>
            <Td>
              {provideBase &&
                r.status === 'REQUESTED' &&
                (providing === r.id ? (
                  <form
                    className="flex flex-col gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void call(
                        `${provideBase}/${r.id}/provide`,
                        {
                          vehicleId: p.vehicleId || null,
                          driverName: p.driverName,
                          driverPhone: p.driverPhone,
                        },
                        t('Vehicle provided'),
                      );
                    }}
                  >
                    <Select
                      value={p.vehicleId}
                      onChange={(e) => setP({ ...p, vehicleId: e.target.value })}
                    >
                      <option value="">{t('Another vehicle')}</option>
                      {(vehicles ?? [])
                        .filter((v) => v.active)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.plate}
                          </option>
                        ))}
                    </Select>
                    <Input
                      required
                      placeholder={t('Driver name')}
                      value={p.driverName}
                      onChange={(e) => setP({ ...p, driverName: e.target.value })}
                    />
                    <Input
                      required
                      placeholder={t('Driver phone')}
                      inputMode="tel"
                      className="ltr-iso"
                      value={p.driverPhone}
                      onChange={(e) => setP({ ...p, driverPhone: e.target.value })}
                    />
                    <Button type="submit">{t('Send vehicle')}</Button>
                  </form>
                ) : (
                  <Button
                    onClick={() => {
                      setProviding(r.id);
                      setP({ vehicleId: '', driverName: '', driverPhone: '' });
                    }}
                  >
                    {t('Provide')}
                  </Button>
                ))}
              {closeBase && (r.status === 'PROVIDED' || r.status === 'REQUESTED') && (
                <div className="flex gap-1">
                  {r.status === 'PROVIDED' && (
                    <Button
                      tone="secondary"
                      onClick={() => void call(`${closeBase}/${r.id}/done`, {}, t('Marked done'))}
                    >
                      {t('Done')}
                    </Button>
                  )}
                  <Button
                    tone="ghost"
                    onClick={() => void call(`${closeBase}/${r.id}/cancel`, {}, t('Cancelled'))}
                  >
                    {t('Cancel')}
                  </Button>
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
