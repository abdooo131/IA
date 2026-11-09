import type { ReactNode } from 'react';
import { type AppListKey, appListConfig, appListData } from './app-lists';
import { ListView } from './ListView';

/**
 * A list page of an app besides Accounting (UX phase C): its title, a plain sentence on what
 * it is for, then the list view for the address it was opened with.
 */
export async function AppListPage({
  list,
  searchParams,
  title,
  intro,
  toolbar,
  children,
}: {
  list: AppListKey;
  searchParams: Record<string, string | string[] | undefined>;
  title: ReactNode;
  intro?: ReactNode;
  /** Buttons next to the search (New order) */
  toolbar?: ReactNode;
  /** Panels above the list */
  children?: ReactNode;
}) {
  const [config, data] = await Promise.all([appListConfig(list), appListData(list, searchParams)]);
  return (
    <>
      <h1 className="text-h2">{title}</h1>
      {intro && <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{intro}</p>}
      {children}
      <ListView config={config} data={data} toolbar={toolbar} />
    </>
  );
}
