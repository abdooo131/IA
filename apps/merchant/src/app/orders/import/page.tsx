'use client';

import { Button, Card, ErrorBox, Money, useApp } from '@shiply/ui';
import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';

interface ImportResult {
  batchId: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  errors: { row: number; field: string; message: string }[];
  created: { row: number; id: string; trackingNumber: string; totalFees: number }[];
}

export default function ImportPage() {
  const { api, t } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setResult(await api.post<ImportResult>('/orders/import', fd));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function printImported() {
    if (!result) return;
    try {
      await api.openBlob('/orders/labels', {
        method: 'POST',
        body: JSON.stringify({ ids: result.created.map((c) => c.id) }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t.importCsv}</h1>
      <Card
        title={t.uploadCsv}
        actions={
          <Button variant="secondary" type="button" onClick={() => api.download('/orders/import/template', 'shiply-orders-template.csv')}>
            {t.downloadTemplate}
          </Button>
        }
      >
        <p className="mb-4 text-sm text-slate-600">{t.importHelp}</p>
        <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" name="file" aria-label={t.chooseFile} className="text-sm" required />
          <Button type="submit" disabled={busy}>{busy ? t.importing : t.uploadCsv}</Button>
        </form>
      </Card>
      <ErrorBox error={error} />

      {result && (
        <Card
          title={t.importResult}
          actions={
            <>
              {result.errors.length > 0 && (
                <Button variant="secondary" onClick={() => api.download(`/orders/import/${result.batchId}/errors.csv`, 'import-errors.csv')}>
                  {t.downloadErrors}
                </Button>
              )}
              {result.created.length > 0 && <Button onClick={printImported}>{t.printSelected} ({result.created.length})</Button>}
            </>
          }
        >
          <div className="mb-4 grid grid-cols-3 gap-3 text-center" data-testid="import-summary">
            <Summary label={t.rows} value={result.totalRows} />
            <Summary label={t.succeeded} value={result.successRows} tone="text-emerald-700" />
            <Summary label={t.failed} value={result.errorRows} tone={result.errorRows ? 'text-rose-700' : undefined} />
          </div>

          {result.errors.length > 0 && (
            <table className="mb-6 min-w-full divide-y divide-slate-200 text-sm" data-testid="import-errors">
              <thead className="bg-rose-50 text-xs text-rose-900">
                <tr>
                  <th className="px-3 py-2 text-start">{t.row}</th>
                  <th className="px-3 py-2 text-start">{t.field}</th>
                  <th className="px-3 py-2 text-start">{t.message}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.errors.map((e, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">{e.row}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{e.field}</td>
                    <td className="px-3 py-1.5">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.created.length > 0 && (
            <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="import-created">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start">{t.row}</th>
                  <th className="px-3 py-2 text-start">{t.tracking}</th>
                  <th className="px-3 py-2 text-end">{t.total}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.created.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-1.5">{c.row}</td>
                    <td className="px-3 py-1.5 font-mono">
                      <Link className="text-teal-800 hover:underline" href={`/orders/${c.id}`}>{c.trackingNumber}</Link>
                    </td>
                    <td className="px-3 py-1.5 text-end"><Money value={c.totalFees} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? 'text-slate-900'}`}>{value}</div>
    </div>
  );
}
