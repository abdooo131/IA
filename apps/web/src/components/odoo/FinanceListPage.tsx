import type { FinanceListId } from '@shiplynow/shared';
import type { ReactNode } from 'react';
import { financeListConfig, financeListData } from './finance-lists';
import { ListView } from './ListView';

/**
 * An Accounting list page: its title, a plain sentence on what it is for, the page's own
 * panels (a form to prepare payouts), then the list view for the address it was opened with.
 */
export async function FinanceListPage({
  id,
  searchParams,
  title,
  intro,
  toolbar,
  children,
  after,
}: {
  id: FinanceListId;
  searchParams: Record<string, string | string[] | undefined>;
  title: ReactNode;
  intro?: ReactNode;
  toolbar?: ReactNode;
  /** Panels above the list */
  children?: ReactNode;
  /** Panels below the list */
  after?: ReactNode;
}) {
  const [config, data] = await Promise.all([
    financeListConfig(id),
    financeListData(id, searchParams),
  ]);
  return (
    <>
      <h1 className="text-h2">{title}</h1>
      {intro && <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{intro}</p>}
      {children}
      <ListView config={config} data={data} toolbar={toolbar} />
      {after}
    </>
  );
}
