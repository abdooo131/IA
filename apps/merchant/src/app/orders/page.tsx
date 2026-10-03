'use client';

import { OrdersTable, queryFromSearch, useApp } from '@shiply/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function OrdersInner() {
  const { t } = useApp();
  const sp = useSearchParams();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-text">{t.orders}</h1>
        <div className="flex gap-2">
          <Link href="/orders/import" className="rounded-lg px-3 py-2 text-sm font-medium text-accent-strong ring-1 ring-inset ring-line hover:bg-accent-soft">{t.importCsv}</Link>
          <Link href="/orders/new" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong">{t.newOrder}</Link>
        </div>
      </div>
      <OrdersTable
        Link={Link}
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
