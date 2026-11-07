'use client';
import { useState } from 'react';
import { SETTINGS, egpToPiastres, type SettingKey } from '@shiply/shared';
import { Alert, Button, Card, Input, Loading, PageHeader, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short names and explanations for each setting. */
// The closed books date is changed only from Books and reports, where closing is checked.
type Editable = Exclude<SettingKey, 'books.closed_through'>;
const LABELS: Record<Editable, [string, string]> = {
  'promise.cutoff': ['Daily cutoff', 'Parcels entering after this time count from tomorrow'],
  'promise.weekend_days': ['Days with no deliveries', 'Skipped when counting the promised date'],
  'delivery.max_attempts': ['Delivery attempts', 'Failed attempts before the parcel goes back to the merchant'],
  'fees.cod_fee_bp': ['COD fee', 'Charged on cash above the free amount'],
  'fees.cod_free_amount': ['COD free amount', 'Cash we collect with no COD fee'],
  'fees.return_fee_bp': ['Return fee', 'Share of shipping charged when a parcel comes back'],
  'tracking.prefix': ['Tracking number prefix', 'Letters at the start of every tracking number'],
  'handover.alert_hours': ['Handover alert (hours)', 'How long a parcel may wait between two teams before it shows as late'],
  'agents.default_commission_bp': ['Default agent commission', 'Used for agents with no commission of their own'],
  'attendance.alert_after_minutes': ['Attendance alert (minutes)', 'Minutes after the shift starts with no check in before the agent is asked'],
  'attendance.replacement_minutes': ['Replacement window (minutes)', 'Time an agent has to send someone after saying a person is not coming'],
  'delivery.code_required': ['Delivery code', 'The receiver gives the courier the code sent to their phone'],
  'courier.ping_seconds': ['Courier location updates', 'Seconds between location updates from a working phone'],
  'pickups.auto_request': ['Automatic pickups', 'Book a pickup when a merchant has parcels waiting and none booked'],
  'shop.open': ['Packaging shop', 'Merchants can order packaging from the shop in their panel'],
  'fees.packaging_delivery': ['Packaging delivery price', 'What delivering one packaging order costs the merchant, VAT included'],
  'shop.free_delivery_from': ['Free packaging delivery from', 'Orders from this amount are delivered free (0 means never)'],
  'cash.shortage_alert': ['Courier cash alert', 'Cash difference that raises an alert'],
  'fees.payout_fee': ['Cash out fee', 'Taken from each merchant payout'],
  'attendance.replacement_penalty': ['Late replacement penalty', 'Charged to the agent each time a replacement comes late or never'],
  'pay.point_value': ['Point value', 'What one courier point is worth'],
  'pay.points_delivery': ['Points per delivery', 'Each parcel delivered to a customer'],
  'pay.points_return': ['Points per return', 'Each parcel handed back to a merchant'],
  'pay.points_pickup_parcel': ['Points per picked up parcel', 'Each parcel the facility receives from a pickup courier'],
  'pay.daily_bonus_parcels': ['Daily bonus target', 'Deliveries in one day that earn the bonus (0 = no bonus)'],
  'pay.daily_bonus_points': ['Daily bonus points', 'Points for reaching the daily target'],
  'pay.freeze_days': ['Earnings freeze (days)', 'Days before a courier can withdraw what they earned'],
  'pay.pickup_paid_by': ['Pickup staff paid by', 'The company pays them directly, or their agent at month end'],
  'tax.vat_bp': ['VAT rate', 'Our prices include it; the books split it out of every fee'],
  'company.name': ['Company name', 'Shown on tax invoices'],
  'company.tax_id': ['Tax registration number', 'Shown on tax invoices and sent to the tax authority'],
  'company.address': ['Company address', 'Shown on tax invoices'],
  'company.activity_code': ['ETA activity code', 'The tax authority code for our activity'],
  'company.item_code': ['ETA item code', 'The code registered for our delivery service'],
  'agents.advance_max_bp': ['Agent advance limit', 'Share of the month so far an agent may take early'],
  'cash.courier_limit': ['Courier cash limit', 'Cash a courier may hold before an alert'],
  'lost.search_hours': ['Search time for lost parcels (hours)', 'How long a missing parcel is searched for before the loss is final'],
  'lost.compensation_cap': ['Lost parcel compensation cap', 'Most we pay a merchant for one lost parcel'],
  'qc.override_hours': ['Ticket waiting time (hours)', 'Time operations have to cancel a quality ticket before its penalty applies'],
  'qc.appeal_hours': ['Appeal window (hours)', 'Time a courier or agent has to appeal a penalty'],
  'fraud.max_failed_per_day': ['Failed attempts fraud check', 'Failed attempts by one courier in a day that raise a check'],
  'fees.open_package': ['Open package fee', 'Added when the customer may open the parcel before paying'],
  'fees.exchange_bp': ['Exchange surcharge', 'Share of shipping added to an exchange parcel'],
  'messages.channel': ['Customer messages by', 'WhatsApp or SMS'],
  'tracking.base_url': ['Tracking page address', 'The link put in customer messages'],
  'cash.safe_limit': ['Hub safe limit', 'Cash a hub safe may hold before it must go to the bank'],
};

const CHOICE_LABELS: Record<string, string> = { COMPANY: 'The company', AGENT: 'Their agent', WHATSAPP: 'WhatsApp', SMS: 'SMS' };

function toText(kind: string, value: unknown): string {
  if (kind === 'money') return String((value as number) / 100);
  if (kind === 'bp') return String((value as number) / 100);
  return String(value ?? '');
}

function SettingRow({ name, value, onSaved }: { name: Editable; value: unknown; onSaved: () => Promise<void> }) {
  const t = useT();
  const def = SETTINGS[name];
  const [text, setText] = useState(toText(def.kind, value));
  const [days, setDays] = useState<number[]>(Array.isArray(value) ? (value as number[]) : []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = (): unknown => {
    switch (def.kind) {
      case 'money':
        return egpToPiastres(text);
      case 'bp': {
        const pct = Number(text);
        return Number.isFinite(pct) && text.trim() !== '' ? Math.round(pct * 100) : null;
      }
      case 'int': {
        const n = Number(text);
        return Number.isInteger(n) ? n : null;
      }
      case 'weekdays':
        return [...days].sort();
      case 'text':
        return text.trim().toUpperCase();
      case 'longtext':
        return text.trim();
      default:
        return text;
    }
  };

  const save = async () => {
    const v = parsed();
    if (v === null) {
      setMsg({ ok: false, text: t('Check the value') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api(`/admin/settings/${name}`, { method: 'PUT', body: { value: v } });
      setMsg({ ok: true, text: t('Saved') });
      await onSaved();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  let input: React.ReactNode;
  if (def.kind === 'choice') {
    const options = (def as { options?: readonly string[] }).options ?? [];
    input = (
      <Select value={text} onChange={(e) => setText(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{t(CHOICE_LABELS[o] ?? o)}</option>)}
      </Select>
    );
  } else if (def.kind === 'weekdays') {
    input = (
      <div className="flex flex-wrap gap-2">
        {DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-1 rounded-md bg-surface-raised px-2 py-1 text-body-sm ring-1 ring-line">
            <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((x) => x !== i))} />
            {t(d)}
          </label>
        ))}
      </div>
    );
  } else {
    const suffix = def.kind === 'money' ? t('EGP') : def.kind === 'bp' ? '%' : null;
    input = (
      <div className="flex items-center gap-2">
        <Input
          type={def.kind === 'time' ? 'time' : 'text'}
          inputMode={def.kind === 'time' || def.kind === 'text' ? undefined : 'decimal'}
          className={def.kind === 'longtext' ? 'w-72' : 'w-36'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {suffix && <span className="text-body-sm text-text-muted">{suffix}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-line py-4 last:border-0 md:flex-row md:items-center">
      <div className="md:w-1/2">
        <div className="text-body-sm font-bold">{t(LABELS[name][0])}</div>
        <div className="text-caption text-text-muted">{t(LABELS[name][1])}</div>
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-3">
        {input}
        <Button tone="secondary" disabled={busy} onClick={save}>{t('Save')}</Button>
        {msg && <span className={msg.ok ? 'text-caption font-bold text-status-delivered' : 'text-caption font-bold text-danger'}>{msg.text}</span>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const { data, error, reload } = useLoad<Record<string, unknown>>('/admin/settings');
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('Settings')} subtitle={t('Business rules used by every facility, hub and courier. Changes apply to new actions at once.')} />
      <Card>
        {(Object.keys(LABELS) as Editable[]).map((key) => (
          <SettingRow key={`${key}-${JSON.stringify(data[key])}`} name={key} value={data[key]} onSaved={reload} />
        ))}
      </Card>
    </div>
  );
}
