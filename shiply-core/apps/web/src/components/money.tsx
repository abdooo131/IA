'use client';
// Small pieces shared by every money screen.
import { egpToPiastres } from '@shiply/shared';
import { useState } from 'react';
import { Alert, Badge, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';

export const REQUEST_LABEL: Record<string, string> = {
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved, not paid',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  SUBMITTED: 'Waiting for check',
  CONFIRMED: 'Confirmed',
};
const TONE: Record<string, 'amber' | 'blue' | 'green' | 'red' | 'slate'> = {
  PENDING_APPROVAL: 'amber',
  SUBMITTED: 'amber',
  APPROVED: 'blue',
  PAID: 'green',
  CONFIRMED: 'green',
  REJECTED: 'red',
  CANCELLED: 'slate',
};

export function RequestBadge({ status, posted }: { status: string; posted?: boolean }) {
  const t = useT();
  // Expenses and journals use PAID to mean posted to the books.
  const label = posted && status === 'PAID' ? 'Posted' : REQUEST_LABEL[status] ?? status;
  return <Badge tone={TONE[status] ?? 'slate'}>{t(label)}</Badge>;
}

export interface FileBody {
  fileName: string;
  mime: string;
  dataBase64: string;
}

export function readFile(file: File): Promise<FileBody> {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) return reject(new Error('The file is larger than 5 MB'));
    const r = new FileReader();
    r.onload = () => resolve({ fileName: file.name, mime: file.type, dataBase64: String(r.result) });
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

/** Amount typed in pounds ("125.50"), kept as text, turned into piastres on submit. */
export function MoneyInput({ value, onChange, required, placeholder }: { value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  return <Input inputMode="decimal" required={required} placeholder={placeholder ?? '0.00'} className="ltr-iso" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function toPiastres(text: string): number {
  const v = egpToPiastres(text);
  if (v === null || v <= 0) throw new Error('Enter an amount like 125 or 125.50');
  return v;
}

/** One message line and a runner that calls the API, shows the result, then reloads. */
export function useRunner(reload?: () => unknown) {
  const t = useT();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: t(okText) });
      await reload?.();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: t(errorMessage(e)) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const call = (path: string, body: unknown = {}, okText = 'Done') => run(() => api(path, { body }), okText);
  const view = msg ? <Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null;
  return { run, call, view, busy, setMsg };
}

/** Downloads a file from the API under the name given. */
export async function downloadFile(path: string, name: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Could not download');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
}

