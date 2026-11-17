import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api-server';

export interface FileStorageStatusData {
  store: 'db' | 'r2';
  moveEnabled: boolean;
  inDatabase: number;
  inR2: number;
  failed: number;
  tables: { slot: string; inDatabase: number; inR2: number; databaseBytes: number }[];
}

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

/**
 * Where uploaded files are kept and how far the move to R2 has come (System > Configuration).
 * Counts only; never a file name or a key.
 */
export async function FileStorageStatus() {
  const [data, t] = await Promise.all([
    apiGet<FileStorageStatusData>('/admin/files/status'),
    getTranslations('admin.fileStorage'),
  ]);
  const total = data.inDatabase + data.inR2;
  const done = total === 0 ? 100 : Math.floor((data.inR2 * 100) / total);
  return (
    <section className="mt-4 max-w-2xl rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('title')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">
        {data.store === 'r2' ? (data.moveEnabled ? t('r2Moving') : t('r2Paused')) : t('database')}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-body-sm">
        <div>
          <dt className="text-text-muted">{t('inDatabase')}</dt>
          <dd className="text-h4 tabular-nums">{data.inDatabase}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('inR2')}</dt>
          <dd className="text-h4 tabular-nums">{data.inR2}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('done')}</dt>
          <dd className="text-h4 tabular-nums">{t('percent', { value: done })}</dd>
        </div>
      </dl>
      {data.failed > 0 && (
        <p className="mt-2 text-body-sm text-status-needs">{t('failed', { count: data.failed })}</p>
      )}
      <table className="mt-3 w-full text-body-sm">
        <thead>
          <tr className="text-start text-text-muted">
            <th className="text-start font-normal">{t('kind')}</th>
            <th className="text-end font-normal">{t('inDatabase')}</th>
            <th className="text-end font-normal">{t('inR2')}</th>
            <th className="text-end font-normal">{t('megabytes')}</th>
          </tr>
        </thead>
        <tbody>
          {data.tables.map((row) => (
            <tr key={row.slot} className="border-t border-line">
              <td className="py-1">{t(`kinds.${row.slot}`)}</td>
              <td className="py-1 text-end tabular-nums">{row.inDatabase}</td>
              <td className="py-1 text-end tabular-nums">{row.inR2}</td>
              <td className="py-1 text-end tabular-nums">{megabytes(row.databaseBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
