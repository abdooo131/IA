'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PARCEL_SIZES, SIZE_LABELS, egpToPiastres } from '@shiplynow/shared/parcels';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
} from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { parseCsv } from '@/parcels/lib/format';
import { Icon } from '@/parcels/components/Icon';
import { egp } from '@/parcels/lib/format';
import { useLocale, useT } from '@/parcels/lib/i18n';
import { useLocations, type Governorate } from '../locations';

const EMPTY = {
  customerName: '',
  customerPhone: '',
  governorateCode: '',
  areaId: '',
  address: '',
  size: 'M',
  cod: '',
  description: '',
  notes: '',
  allowOpen: false,
  exchange: false,
  customerReturn: false,
  merchantRef: '',
};

const CSV_HEADERS = [
  'customerName',
  'customerPhone',
  'address',
  'governorate',
  'area',
  'size',
  'cod',
  'description',
  'notes',
  'allowOpen',
  'merchantRef',
];
const CSV_SAMPLE = [
  'Mona Ali',
  '01012345678',
  '5 Tahrir St, Dokki',
  'GIZ',
  'Dokki',
  'M',
  '450',
  'Dress',
  'Call before',
  'yes',
  'ORDER1001',
];

export default function NewParcelPage() {
  const { data: govs } = useLocations();
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('Merchant')}
        title={t('New parcel')}
        subtitle={t('Create one parcel, or upload many from a spreadsheet')}
      />
      <SingleForm govs={govs ?? []} />
      <CsvUpload govs={govs ?? []} />
    </div>
  );
}

function SingleForm({ govs }: { govs: Governorate[] }) {
  const t = useT();
  const locale = useLocale();
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; trackingNumber: string } | null>(null);
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) =>
    setF((cur) => ({ ...cur, [k]: v }));
  const gov = govs.find((g) => g.code === f.governorateCode);
  // The price before booking, as in Shiply Now's new order screen.
  const [price, setPrice] = useState<{
    shippingFee: number;
    basePrice: number;
    discount: number;
    openFee: number;
    exchangeFee: number;
    vatIncluded: number;
    zone: string;
    transitDays: number;
  } | null>(null);
  useEffect(() => {
    if (!f.governorateCode) return setPrice(null);
    const q = new URLSearchParams({
      governorateCode: f.governorateCode,
      size: f.size,
      allowOpen: f.allowOpen ? 'true' : '',
      exchange: f.exchange ? 'true' : '',
    });
    if (f.areaId) q.set('areaId', f.areaId);
    api<typeof price>(`/merchant/quote?${q}`)
      .then(setPrice)
      .catch(() => setPrice(null));
  }, [f.governorateCode, f.areaId, f.size, f.allowOpen, f.exchange]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cod = f.cod.trim() === '' ? 0 : egpToPiastres(f.cod);
    if (cod === null) {
      setError(t('COD must be an amount in EGP, like 450 or 450.50'));
      return;
    }
    setBusy(true);
    try {
      const s = await api<{ id: string; trackingNumber: string }>('/merchant/shipments', {
        body: {
          customerName: f.customerName,
          customerPhone: f.customerPhone,
          governorateCode: f.governorateCode,
          areaId: f.areaId || null,
          address: f.address,
          size: f.size,
          codAmount: f.customerReturn ? 0 : cod,
          description: f.description,
          notes: f.notes,
          allowOpen: f.customerReturn ? false : f.allowOpen,
          exchange: f.customerReturn ? false : f.exchange,
          customerReturn: f.customerReturn,
          merchantRef: f.merchantRef,
        },
      });
      setCreated(s);
      setF({ ...EMPTY, governorateCode: f.governorateCode, size: f.size });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="create" size={22} className="text-link" />
          {t('One parcel')}
        </span>
      }
    >
      {created && (
        <div className="mb-4">
          <Alert tone="success">
            {t('Created')}{' '}
            <span className="ltr-iso font-mono font-bold">{created.trackingNumber}</span>.{' '}
            <a
              href={`/parcels/labels?ids=${created.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-link underline"
            >
              {t('Print label')}
            </a>
            {' · '}
            <Link
              href={`/parcels/merchant/${created.id}`}
              className="font-bold text-link underline"
            >
              {t('Open')}
            </Link>
          </Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Customer name')}>
          <Input
            required
            value={f.customerName}
            onChange={(e) => set('customerName', e.target.value)}
          />
        </Field>
        <Field label={t('Customer mobile')} hint={t('Egyptian mobile, like 01012345678')}>
          <Input
            required
            inputMode="tel"
            dir="ltr"
            value={f.customerPhone}
            onChange={(e) => set('customerPhone', e.target.value)}
          />
        </Field>
        <Field label={t('Governorate')}>
          <Select
            required
            value={f.governorateCode}
            onChange={(e) =>
              setF((cur) => ({ ...cur, governorateCode: e.target.value, areaId: '' }))
            }
          >
            <option value="">{t('Choose…')}</option>
            {govs.map((g) => (
              <option key={g.code} value={g.code} disabled={!g.served}>
                {name(g)}
                {g.served ? '' : ` (${t('not served yet')})`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Area')} hint={t('Optional')}>
          <Select
            value={f.areaId}
            onChange={(e) => set('areaId', e.target.value)}
            disabled={!gov || gov.areas.length === 0}
          >
            <option value="">
              {gov && gov.areas.length ? t('Any area') : t('No areas listed')}
            </option>
            {gov?.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {name(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Address')} className="sm:col-span-2">
          <Textarea
            required
            rows={2}
            value={f.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>
        <Field label={t('Size')}>
          <Select value={f.size} onChange={(e) => set('size', e.target.value)}>
            {PARCEL_SIZES.map((s) => (
              <option key={s} value={s}>
                {t(SIZE_LABELS[s])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('Cash to collect (EGP)')} hint={t('Leave empty if already paid')}>
          <Input
            inputMode="decimal"
            dir="ltr"
            value={f.cod}
            onChange={(e) => set('cod', e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label={t('What is inside')}>
          <Input value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label={t('Your reference')} hint={t('Order number in your store')}>
          <Input value={f.merchantRef} onChange={(e) => set('merchantRef', e.target.value)} />
        </Field>
        <Field label={t('Notes for the courier')} className="sm:col-span-2">
          <Input value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-body-sm sm:col-span-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={f.allowOpen}
            onChange={(e) => set('allowOpen', e.target.checked)}
          />
          {t('Customer may open the parcel before paying')}
        </label>
        <label className="flex items-center gap-2 text-body-sm sm:col-span-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={f.exchange}
            onChange={(e) => set('exchange', e.target.checked)}
          />
          {t('Exchange: the courier brings the old item back in the same visit')}
        </label>
        <label className="flex items-center gap-2 text-body-sm sm:col-span-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={f.customerReturn}
            onChange={(e) => set('customerReturn', e.target.checked)}
          />
          {t(
            'Return from a customer: the courier collects the item from them and brings it to you',
          )}
        </label>
        {price && (
          <div className="rounded-lg border border-line bg-surface-raised p-4 text-body-sm sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="font-bold">{t('Shipping price')}</span>
              <span className="tabular ltr-iso text-h3">{egp(price.shippingFee)}</span>
            </div>
            <p className="mt-1 text-caption text-text-muted">
              {t(price.zone)} · {t('{n} days', { n: price.transitDays })} · {t('List price')}{' '}
              {egp(price.basePrice)}
              {price.discount > 0 && ` · ${t('Discount')} ${egp(-price.discount)}`}
              {price.openFee > 0 && ` · ${t('Open package fee')} ${egp(price.openFee)}`}
              {price.exchangeFee > 0 && ` · ${t('Exchange')} ${egp(price.exchangeFee)}`}
              {` · ${t('Includes VAT')} ${egp(price.vatIncluded)}`}
            </p>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? t('Creating…') : t('Create parcel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface BulkResult {
  created: { row: number; trackingNumber: string }[];
  failed: { row: number; message: string }[];
}

function CsvUpload({ govs }: { govs: Governorate[] }) {
  const t = useT();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [problems, setProblems] = useState<{ row: number; message: string }[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const downloadTemplate = () => {
    const csv = `${CSV_HEADERS.join(',')}\n${CSV_SAMPLE.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',')}\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shiply-parcels-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    setResult(null);
    setError(null);
    setRows(null);
    setProblems([]);
    if (!file) return;
    setFileName(file.name);
    const table = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
    if (table.length < 2) {
      setError(t('The file has no parcel rows'));
      return;
    }
    const header = table[0]!.map((h) => h.trim());
    const missing = ['customerName', 'customerPhone', 'address', 'governorate'].filter(
      (h) => !header.includes(h),
    );
    if (missing.length) {
      setError(
        t('Missing columns: {cols}. Download the template to see the format', {
          cols: missing.join(', '),
        }),
      );
      return;
    }
    const out: Record<string, unknown>[] = [];
    const bad: { row: number; message: string }[] = [];
    table.slice(1).forEach((cells, i) => {
      const get = (name: string) => (cells[header.indexOf(name)] ?? '').trim();
      const govText = get('governorate').toLowerCase();
      const gov = govs.find(
        (g) =>
          g.code.toLowerCase() === govText ||
          g.nameEn.toLowerCase() === govText ||
          g.nameAr === get('governorate'),
      );
      const areaText = get('area').toLowerCase();
      const area =
        gov && areaText
          ? gov.areas.find((a) => a.nameEn.toLowerCase() === areaText || a.nameAr === get('area'))
          : undefined;
      const codText = get('cod');
      const cod = codText === '' ? 0 : egpToPiastres(codText);
      const sizeText = get('size').toUpperCase() || 'M';
      // Rows we can check here are reported now; the server checks the rest.
      if (!gov)
        bad.push({
          row: i + 1,
          message: t('Unknown governorate "{v}"', { v: get('governorate') }),
        });
      else if (areaText && !area)
        bad.push({
          row: i + 1,
          message: t('Unknown area "{v}" in {gov}', { v: get('area'), gov: gov.nameEn }),
        });
      else if (cod === null)
        bad.push({ row: i + 1, message: t('COD "{v}" is not an amount in EGP', { v: codText }) });
      out.push({
        customerName: get('customerName'),
        customerPhone: get('customerPhone'),
        address: get('address'),
        governorateCode: gov?.code ?? get('governorate'),
        areaId: area?.id ?? null,
        size: sizeText,
        codAmount: cod ?? 0,
        description: get('description'),
        notes: get('notes'),
        allowOpen: ['yes', 'y', 'true', '1', 'نعم'].includes(get('allowOpen').toLowerCase()),
        merchantRef: get('merchantRef'),
      });
    });
    setRows(out);
    setProblems(bad);
  };

  const upload = async () => {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const badRows = new Set(problems.map((p) => p.row));
      const send = rows.map((r, i) => ({ r, row: i + 1 })).filter((x) => !badRows.has(x.row));
      const res = await api<BulkResult>('/merchant/shipments/bulk', {
        body: { rows: send.map((x) => x.r) },
      });
      // Map server row numbers back to the rows in the file.
      setResult({
        created: res.created.map((c) => ({ ...c, row: send[c.row - 1]!.row })),
        failed: [...problems, ...res.failed.map((f) => ({ ...f, row: send[f.row - 1]!.row }))].sort(
          (a, b) => a.row - b.row,
        ),
      });
      setRows(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="inventory" size={22} className="text-link" />
          {t('Upload a spreadsheet')}
        </span>
      }
      actions={
        <Button tone="ghost" onClick={downloadTemplate}>
          {t('Download template')}
        </Button>
      }
    >
      <p className="mb-3 text-body-sm text-text-muted">
        {t(
          'Save your sheet as CSV. Governorate can be the code (GIZ) or the English name. COD is in EGP. Up to 500 rows at a time.',
        )}
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => void onFile(e.target.files?.[0])}
        className="block w-full text-body-sm file:me-3 file:rounded-md file:border-0 file:bg-selected-bg file:px-4 file:py-2 file:font-bold file:text-link"
      />
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {rows && (
        <div className="mt-4 space-y-3">
          <Alert tone={problems.length ? 'warning' : 'info'}>
            {fileName}: {t('{n} rows found', { n: rows.length })}
            {problems.length
              ? `, ${t('{n} with problems that will be skipped', { n: problems.length })}`
              : ''}
            .
          </Alert>
          {problems.length > 0 && (
            <RowList items={problems.map((p) => ({ row: p.row, text: p.message }))} bad />
          )}
          <Button onClick={upload} disabled={busy || rows.length === problems.length}>
            {busy ? t('Uploading…') : t('Create {n} parcels', { n: rows.length - problems.length })}
          </Button>
        </div>
      )}
      {result && (
        <div className="mt-4 space-y-3">
          <Alert tone={result.failed.length ? 'warning' : 'success'}>
            {t('{n} parcels created', { n: result.created.length })}
            {result.failed.length ? `, ${t('{n} rows failed', { n: result.failed.length })}` : ''}.
          </Alert>
          {result.failed.length > 0 && (
            <RowList items={result.failed.map((f) => ({ row: f.row, text: f.message }))} bad />
          )}
          {result.created.length > 0 && (
            <RowList items={result.created.map((c) => ({ row: c.row, text: c.trackingNumber }))} />
          )}
          {result.created.length > 0 && (
            <p className="text-body-sm text-text-muted">
              {t('Print their labels from the')}{' '}
              <Link href="/parcels/merchant" className="font-bold text-link underline">
                {t('parcels list')}
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function RowList({ items, bad }: { items: { row: number; text: string }[]; bad?: boolean }) {
  const t = useT();
  return (
    <div className="max-h-64 overflow-y-auto rounded-md ring-1 ring-line">
      <Table head={[t('Row'), bad ? t('Problem') : t('Tracking number')]}>
        {items.map((i) => (
          <tr key={`${i.row}${i.text}`}>
            <Td className="tabular">{i.row}</Td>
            <Td
              className={bad ? 'whitespace-normal font-semibold text-danger' : 'ltr-iso font-mono'}
            >
              {i.text}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
