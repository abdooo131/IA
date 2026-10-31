/** A labelled number. Numbers stay left to right inside Arabic text. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-h3">
        <span className="ltr-iso">{value}</span>
        {hint && <span className="ms-1 text-body-sm font-normal text-text-muted">{hint}</span>}
      </dd>
    </div>
  );
}
