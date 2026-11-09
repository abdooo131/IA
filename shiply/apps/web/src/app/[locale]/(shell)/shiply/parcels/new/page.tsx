'use client';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { SHIPLY_MENU } from '../../menu';
import { useLookups } from '../../shared';
import { NewParcelForm } from '../NewParcelForm';

export default function NewParcel() {
  const t = useTranslations();
  const router = useRouter();
  const look = useLookups();
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <div className="page-head">
        <h1>{t('shiply.newParcel')}</h1>
      </div>
      <div className="card" style={{ maxWidth: 640 }}>
        <NewParcelForm merchants={look.merchants} onCreated={(id) => router.push(`/shiply/parcels/${id}`)} />
      </div>
    </AppShell>
  );
}
