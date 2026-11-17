import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

const tab = (on: boolean) =>
  `rounded-md px-3 py-2 text-body-sm font-bold ${on ? 'bg-selected-bg text-link' : 'text-text-muted'}`;

/** The pipeline's title with the board and list switch and the Add lead button. */
export async function SalesHeader({
  title,
  view,
  canAdd,
  extra,
}: {
  title: string;
  view?: 'board' | 'list';
  canAdd: boolean;
  extra?: React.ReactNode;
}) {
  const t = await getTranslations('sales');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-h2">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {view && (
          <nav aria-label={t('board.views')} className="flex gap-1">
            <Link
              href="/admin/sales/pipeline"
              className={tab(view === 'board')}
              aria-current={view === 'board' ? 'page' : undefined}
            >
              {t('board.boardView')}
            </Link>
            <Link
              href="/admin/sales/deals"
              className={tab(view === 'list')}
              aria-current={view === 'list' ? 'page' : undefined}
            >
              {t('board.listView')}
            </Link>
          </nav>
        )}
        {extra}
        {canAdd && (
          <Link href="/admin/sales/new" className="btn-primary">
            {t('addLead')}
          </Link>
        )}
      </div>
    </div>
  );
}
