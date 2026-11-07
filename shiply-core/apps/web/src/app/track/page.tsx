'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';

export default function TrackPage() {
  const router = useRouter();
  const [number, setNumber] = useState('');
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white">S</span>
          <div>
            <h1 className="text-lg font-bold">Track your parcel</h1>
            <p className="text-sm text-slate-600">Shiply next day delivery</p>
          </div>
        </div>
        <form
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
          onSubmit={(e) => {
            e.preventDefault();
            const n = number.trim().toUpperCase().replace(/\s+/g, '');
            if (n) router.push(`/track/${encodeURIComponent(n)}`);
          }}
        >
          <label htmlFor="tn" className="mb-1 block text-sm font-medium text-slate-700">Tracking number</label>
          <Input id="tn" autoFocus placeholder="SHP0000010005" value={number} onChange={(e) => setNumber(e.target.value)} className="font-mono uppercase" />
          <Button type="submit" className="mt-4 w-full" disabled={!number.trim()}>Track</Button>
        </form>
      </div>
    </div>
  );
}
