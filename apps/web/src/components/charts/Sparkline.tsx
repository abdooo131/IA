/**
 * A small line of the last days (one series, in the primary color), for dashboard cards.
 * Time runs left to right in Arabic too. Decorative next to the number it sits under, so
 * screen readers get the summary in `label` only.
 */
export function Sparkline({
  values,
  label,
  width = 160,
  height = 36,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className="block text-primary"
    >
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill="currentColor"
        opacity="0.08"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
