'use client';
import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';

export default function FleetHome() {
  const router = useRouter();
  useEffect(() => router.replace('/fleet/people'), [router]);
  return null;
}
