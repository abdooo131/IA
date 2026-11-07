import type { ReactNode } from 'react';

/** A plain table for the data pages: a title, headers and rows, scrolling sideways on phones. */
export function DataTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-body-sm text-text-muted">{empty}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-body-sm">
            <thead className="border-b border-line">
              <tr>
                {headers.map((h, i) => (
                  <th key={h} className={`${th} ${i > 0 ? 'text-end' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className={`px-3 py-2 ${j > 0 ? 'ltr-iso text-end' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
