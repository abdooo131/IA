/**
 * One series of columns over time, drawn in HTML so text stays crisp in both languages.
 * Time runs left to right in Arabic too. Each column shows its exact value on hover or
 * focus, and a hidden table gives screen readers the same numbers.
 */
export interface Column {
  key: string;
  /** Short axis label, for example 14/01 */
  label: string;
  value: number;
  /** The hover text, already formatted */
  detail: string;
}

function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return value;
}

export function ColumnChart({
  columns,
  title,
  valueLabel,
  height = 180,
}: {
  columns: Column[];
  /** Read by screen readers and used as the table caption */
  title: string;
  valueLabel: string;
  height?: number;
}) {
  const max = niceMax(Math.max(0, ...columns.map((c) => c.value)));
  const ticks = [max, max / 2, 0];
  // Show at most about 7 axis labels so they never collide.
  const every = Math.max(1, Math.ceil(columns.length / 7));
  return (
    <figure className="m-0">
      <div dir="ltr" className="flex gap-2" role="img" aria-label={title}>
        <div
          className="flex flex-col justify-between text-end text-caption text-text-muted"
          style={{ height }}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <span key={t} className="tabular -translate-y-2 leading-none">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }}>
            {ticks.map((t) => (
              <span
                key={t}
                aria-hidden="true"
                className={`absolute inset-x-0 border-t ${t === 0 ? 'border-text-muted opacity-40' : 'border-line'}`}
                style={{ bottom: `${(t / max) * 100}%` }}
              />
            ))}
            <ol className="absolute inset-0 flex items-end gap-[2px]">
              {columns.map((c) => (
                <li
                  key={c.key}
                  tabIndex={0}
                  aria-label={c.detail}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                >
                  <span
                    className="block w-full max-w-[28px] rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-80"
                    style={{ height: `${(c.value / max) * 100}%`, minHeight: c.value ? 2 : 0 }}
                  />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-text px-2 py-1 text-caption text-surface shadow-md group-hover:block group-focus-visible:block"
                  >
                    {c.detail}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <ol className="mt-1 flex gap-[2px]" aria-hidden="true">
            {columns.map((c, i) => (
              <li
                key={c.key}
                className="flex flex-1 justify-center whitespace-nowrap text-caption text-text-muted"
              >
                {i % every === 0 ? c.label : ''}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {columns.map((c) => (
            <tr key={c.key}>
              <th scope="row">{c.label}</th>
              <td>
                {c.value} {valueLabel}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
