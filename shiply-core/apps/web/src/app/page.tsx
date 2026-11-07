'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { HOME_BY_ROLE, type Me } from '@/components/Shell';
import { Loading } from '@/components/ui';
import { api } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api<Me>('/auth/me')
      .then((me) => router.replace(HOME_BY_ROLE[me.role]))
      .catch(() => undefined);
  }, [router]);
  return <Loading />;
}
