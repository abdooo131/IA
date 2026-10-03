'use client';

import { OrderDetail, useApp } from '@shiply/ui';
import Link from 'next/link';
import { use } from 'react';

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, lang } = useApp();
  return (
    <div className="space-y-4">
      <Link href="/orders" className="text-sm text-accent-strong hover:underline">{lang === 'ar' ? '→' : '←'} {t.orders}</Link>
      <OrderDetail id={id} />
    </div>
  );
}
