import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Avatar } from '@/components/hr/Avatar';
import { ChecklistsPanel } from '@/components/hr/ChecklistsPanel';
import { EmployeeHeader } from '@/components/hr/EmployeeHeader';
import { apiGet } from '@/lib/api-server';
import type { EmployeeChecklist, EmployeeFile } from '@/lib/hr-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** One person of my team: their header and onboarding, never pay, ID numbers or documents. */
export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/my-file/team');
  const { id } = await params;
  const [file, t] = await Promise.all([
    apiGet<EmployeeFile & { checklists: EmployeeChecklist[] }>(`/me/team/${id}`),
    getTranslations('people'),
  ]);
  const open = file.checklists.filter((c) => c.status === 'open');
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <Link href="/my-file/team" className="text-body-sm text-link">
          {t('backTeam')}
        </Link>
        <div className="mt-2">
          <EmployeeHeader
            file={file}
            photo={
              <Avatar
                employeeId={file.id}
                photoVersion={file.photoVersion}
                name={file.nameEn}
                size="xl"
              />
            }
          />
        </div>
        {file.team && file.team.total > 0 && (
          <p className="mt-4 text-body-sm">
            {t('teamLine', { direct: file.team.direct, total: file.team.total })}
          </p>
        )}
        {open.length > 0 && (
          <ChecklistsPanel
            employeeId={file.id}
            checklists={open}
            templates={[]}
            canUse={false}
            canManage={false}
          />
        )}
      </main>
    </div>
  );
}
