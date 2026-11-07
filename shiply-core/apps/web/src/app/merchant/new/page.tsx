'use client';
import Link from 'next/link';
import { useState } from 'react';
import { PARCEL_SIZES, egpToPiastres } from '@shiply/shared';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Table, Td, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { parseCsv } from '@/lib/format';
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
  merchantRef: '',
};

const CSV_HEADERS = ['customerName', 'customerPhone', 'address', 'governorate', 'area', 'size', 'cod', 'description', 'notes', 'allowOpen', 'merchantRef'];
const CSV_SAMPLE = ['Mona Ali', '01012345678', '5 Tahrir St, Dokki', 'GIZ', 'Dokki', 'M', '450', 'Dress', 'Call before', 'yes', 'ORDER1001'];

export default function NewParcelPage() {
  const { data: govs } = useLocations();
  return (
    <div className="space-y-6">
      <PageHeader title="New parcel" subtitle="Create one parcel, or upload many from a spreadsheet" />
      <SingleForm govs={govs ?? []} />
      <CsvUpload govs={govs ?? []} />
    </div>
  );
}

function SingleForm({ govs }: { govs: Governorate[] }) {
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; trackingNumber: string } | null>(null);
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const gov = govs.find((g) => g.code === f.governorateCode);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cod = f.cod.trim() === '' ? 0 : egpToPiastres(f.cod);
    if (cod === null) {
      setError('COD must be an amount in EGP, like 450 or 450.50');
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
          codAmount: cod,
          description: f.description,
          notes: f.notes,
          allowOpen: f.allowOpen,
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
    <Card title="One parcel">
      {created && (
        <div className="mb-4">
          <Alert tone="success">
            Created <span className="font-mono font-semibold">{created.trackingNumber}</span>.{' '}
            <a href={`/labels?ids=${created.id}`} target="_blank" rel="noreferrer" className="font-semibold underline">Print label</a>
            {' · '}
            <Link href={`/merchant/${created.id}`} className="font-semibold underline">Open</Link>
          </Alert>
        </div>
      )}
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer name">
          <Input required value={f.customerName} onChange={(e) => set('customerName', e.target.value)} />
        </Field>
        <Field label="Customer mobile" hint="Egyptian mobile, like 01012345678">
          <Input required inputMode="tel" value={f.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
        </Field>
        <Field label="Governorate">
          <Select required value={f.governorateCode} onChange={(e) => setF((cur) => ({ ...cur, governorateCode: e.target.value, areaId: '' }))}>
            <option value="">Choose…</option>
            {govs.map((g) => (
              <option key={g.code} value={g.code} disabled={!g.served}>
                {g.nameEn}{g.served ? '' : ' (not served yet)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Area" hint="Optional">
          <Select value={f.areaId} onChange={(e) => set('areaId', e.target.value)} disabled={!gov || gov.areas.length === 0}>
            <option value="">{gov && gov.areas.length ? 'Any area' : 'No areas listed'}</option>
            {gov?.areas.map((a) => (
              <option key={a.id} value={a.id}>{a.nameEn}</option>
            ))}
          </Select>
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea required rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Size">
          <Select value={f.size} onChange={(e) => set('size', e.target.value)}>
            {PARCEL_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Cash to collect (EGP)" hint="Leave empty if already paid">
          <Input inputMode="decimal" value={f.cod} onChange={(e) => set('cod', e.target.value)} placeholder="0" />
        </Field>
        <Field label="What is inside">
          <Input value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Your reference" hint="Order number in your store">
          <Input value={f.merchantRef} onChange={(e) => set('merchantRef', e.target.value)} />
        </Field>
        <Field label="Notes for the courier" className="sm:col-span-2">
          <Input value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" className="h-5 w-5" checked={f.allowOpen} onChange={(e) => set('allowOpen', e.target.checked)} />
          Customer may open the parcel before paying
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create parcel'}</Button>
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
    const table = parseCsv((await file.text()).replace(/^﻿/, ''));
    if (table.length < 2) {
      setError('The file has no parcel rows');
      return;
    }
    const header = table[0]!.map((h) => h.trim());
    const missing = ['customerName', 'customerPhone', 'address', 'governorate'].filter((h) => !header.includes(h));
    if (missing.length) {
      setError(`Missing columns: ${missing.join(', ')}. Download the template to see the format`);
      return;
    }
    const out: Record<string, unknown>[] = [];
    const bad: { row: number; message: string }[] = [];
    table.slice(1).forEach((cells, i) => {
      const get = (name: string) => (cells[header.indexOf(name)] ?? '').trim();
      const govText = get('governorate').toLowerCase();
      const gov = govs.find((g) => g.code.toLowerCase() === govText || g.nameEn.toLowerCase() === govText || g.nameAr === get('governorate'));
      const areaText = get('area').toLowerCase();
      const area = gov && areaText ? gov.areas.find((a) => a.nameEn.toLowerCase() === areaText || a.nameAr === get('area')) : undefined;
      const codText = get('cod');
      const cod = codText === '' ? 0 : egpToPiastres(codText);
      const sizeText = get('size').toUpperCase() || 'M';
      // Rows we can check here are reported now; the server checks the rest.
      if (!gov) bad.push({ row: i + 1, message: `Unknown governorate "${get('governorate')}"` });
      else if (areaText && !area) bad.push({ row: i + 1, message: `Unknown area "${get('area')}" in ${gov.nameEn}` });
      else if (cod === null) bad.push({ row: i + 1, message: `COD "${codText}" is not an amount in EGP` });
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
      const res = await api<BulkResult>('/merchant/shipments/bulk', { body: { rows: send.map((x) => x.r) } });
      // Map server row numbers back to the rows in the file.
      setResult({
        created: res.created.map((c) => ({ ...c, row: send[c.row - 1]!.row })),
        failed: [...problems, ...res.failed.map((f) => ({ ...f, row: send[f.row - 1]!.row }))].sort((a, b) => a.row - b.row),
      });
      setRows(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Upload a spreadsheet" actions={<Button tone="ghost" onClick={downloadTemplate}>Download template</Button>}>
      <p className="mb-3 text-sm text-slate-600">
        Save your sheet as CSV. Governorate can be the code (GIZ) or the English name. COD is in EGP. Up to 500 rows at a time.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => void onFile(e.target.files?.[0])}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:font-semibold file:text-brand-700"
      />
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {rows && (
        <div className="mt-4 space-y-3">
          <Alert tone={problems.length ? 'warning' : 'info'}>
            {fileName}: {rows.length} rows found{problems.length ? `, ${problems.length} with problems that will be skipped` : ''}.
          </Alert>
          {problems.length > 0 && <RowList items={problems.map((p) => ({ row: p.row, text: p.message }))} bad />}
          <Button onClick={upload} disabled={busy || rows.length === problems.length}>
            {busy ? 'Uploading…' : `Create ${rows.length - problems.length} parcels`}
          </Button>
        </div>
      )}
      {result && (
        <div className="mt-4 space-y-3">
          <Alert tone={result.failed.length ? 'warning' : 'success'}>
            {result.created.length} parcels created{result.failed.length ? `, ${result.failed.length} rows failed` : ''}.
          </Alert>
          {result.failed.length > 0 && <RowList items={result.failed.map((f) => ({ row: f.row, text: f.message }))} bad />}
          {result.created.length > 0 && <RowList items={result.created.map((c) => ({ row: c.row, text: c.trackingNumber }))} />}
          {result.created.length > 0 && (
            <p className="text-sm text-slate-600">
              Print their labels from the <Link href="/merchant" className="font-semibold text-brand-700 underline">parcels list</Link>.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function RowList({ items, bad }: { items: { row: number; text: string }[]; bad?: boolean }) {
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-slate-200">
      <Table head={['Row', bad ? 'Problem' : 'Tracking number']}>
        {items.map((i) => (
          <tr key={`${i.row}${i.text}`}>
            <Td className="tabular-nums">{i.row}</Td>
            <Td className={bad ? 'whitespace-normal text-rose-700' : 'font-mono'}>{i.text}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

