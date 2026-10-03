'use client';

import { OrdersTable, queryFromSearch, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function OrdersInner() {
  const { t, api } = useApp();
  const sp = useSearchParams();
  const router = useRouter();
  const merchants = useAsync(() => api.get<{ id: string; nameEn: string; nameAr: string }[]>('/admin/merchants'), []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">{t.orders}</h1>
      <OrdersTable
        Link={Link}
        showMerchant
        merchants={merchants.data ?? []}
        initialQuery={queryFromSearch(new URLSearchParams(sp.toString()))}
        onQueryChange={(q) => router.replace(`/orders?${new URLSearchParams(q).toString()}`)}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersInner />
    </Suspense>
  );
}
