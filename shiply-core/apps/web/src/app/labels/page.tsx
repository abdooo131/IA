'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Label, type LabelData } from '@/components/Label';
import { Alert, Button, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

interface ParcelForLabel {
  id: string;
  trackingNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  governorateCode: string;
  areaId: string | null;
  destinationHubId: string;
  codAmount: number;
  size: string;
  allowOpen: boolean;
  merchantRef: string;
  description: string;
  merchant?: { name: string };
  hubCodes?: Record<string, string>;
}
interface Gov {
  code: string;
  areas: { id: string; nameEn: string }[];
}

async function loadParcel(id: string): Promise<ParcelForLabel> {
  try {
    return await api<ParcelForLabel>(`/merchant/shipments/${id}`);
  } catch (e) {
    // Admin accounts cannot open merchant routes; they read the same parcel from admin.
    try {
      return await api<ParcelForLabel>(`/admin/shipments/${id}`);
    } catch {
      throw e;
    }
  }
}

function Labels() {
  const params = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 200);
  const [labels, setLabels] = useState<LabelData[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const key = ids.join(',');

  useEffect(() => {
    let alive = true;
    (async () => {
      const govs = await api<Gov[]>('/reference/locations').catch(() => [] as Gov[]);
      const out: LabelData[] = [];
      const problems: string[] = [];
      for (const id of key ? key.split(',') : []) {
        try {
          const p = await loadParcel(id);
          const area = govs.find((g) => g.code === p.governorateCode)?.areas.find((a) => a.id === p.areaId);
          const hubCode = p.hubCodes?.[p.destinationHubId];
          out.push({
            trackingNumber: p.trackingNumber,
            route: hubCode ?? p.governorateCode,
            routeDetail: hubCode ? `${p.governorateCode}${area ? ` · ${area.nameEn}` : ''}` : area?.nameEn,
            merchantName: p.merchant?.name,
            customerName: p.customerName,
            customerPhone: p.customerPhone,
            address: p.address,
            codAmount: p.codAmount,
            size: p.size,
            allowOpen: p.allowOpen,
            merchantRef: p.merchantRef,
            description: p.description,
          });
        } catch (e) {
          problems.push(errorMessage(e));
        }
      }
      if (alive) {
        setLabels(out);
        setErrors(problems);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  if (ids.length === 0) return <div className="p-6"><Alert>No parcels chosen. Select parcels in the list, then print labels.</Alert></div>;
  if (!labels) return <Loading />;

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <style>{`@page { size: 100mm 150mm; margin: 0; } @media print { .label { page-break-after: always; break-after: page; } } @media screen and (max-width: 420px) { .label { zoom: 0.88; } }`}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <span className="text-sm font-semibold">{labels.length} label{labels.length === 1 ? '' : 's'} · 100 × 150 mm</span>
        <Button onClick={() => window.print()} disabled={labels.length === 0}>Print</Button>
      </div>
      {errors.length > 0 && (
        <div className="no-print mx-auto max-w-md p-4">
          <Alert>{errors.length} label(s) could not be loaded: {errors.join('; ')}</Alert>
        </div>
      )}
      <div className="space-y-4 py-4 print:space-y-0 print:py-0">
        {labels.map((l) => (
          <Label key={l.trackingNumber} data={l} />
        ))}
      </div>
    </div>
  );
}

export default function LabelsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Labels />
    </Suspense>
  );
}
