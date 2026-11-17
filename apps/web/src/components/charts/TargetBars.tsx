import { Icon } from '../Icon';

/**
 * Horizontal bars against a target line (for example stage minutes against the SLA).
 * A bar past its target turns the needs action color and says so in words, never by
 * color alone.
 */
export interface TargetBar {
  key: string;
  label: string;
  value: number | null;
  target: number | null;
  /** The formatted value, for example "7 min" */
  valueText: string;
  /** The formatted target, for example "target 10 min" */
  targetText?: string;
}

export function TargetBars({ bars, overLabel }: { bars: TargetBar[]; overLabel: string }) {
  const max = Math.max(1, ...bars.flatMap((b) => [b.value ?? 0, b.target ?? 0])) * 1.1;
  return (
    <ul className="space-y-3">
      {bars.map((b) => {
        const over = b.value !== null && b.target !== null && b.value > b.target;
        return (
          <li key={b.key}>
            <div className="flex items-baseline justify-between gap-2 text-body-sm">
              <span className="font-semibold">{b.label}</span>
              <span className="flex items-center gap-1">
                {over && (
                  <span className="flex items-center gap-1 text-caption font-bold text-status-needs-action">
                    <Icon name="alert" size={16} />
                    {overLabel}
                  </span>
                )}
                <span className="tabular ltr-iso font-bold">{b.valueText}</span>
              </span>
            </div>
            <div dir="ltr" className="relative mt-1 h-2.5 rounded-pill bg-surface-raised">
              {b.value !== null && (
                <span
                  className={`absolute inset-y-0 left-0 rounded-pill ${over ? 'bg-status-needs-action' : 'bg-primary'}`}
                  style={{ width: `${(b.value / max) * 100}%` }}
                />
              )}
              {b.target !== null && (
                <span
                  aria-hidden="true"
                  className="absolute -inset-y-1 w-0.5 rounded bg-text"
                  style={{ left: `${(b.target / max) * 100}%` }}
                />
              )}
            </div>
            {b.targetText && <p className="mt-0.5 text-caption text-text-muted">{b.targetText}</p>}
          </li>
        );
      })}
    </ul>
  );
}
