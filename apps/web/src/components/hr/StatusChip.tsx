/** An employee's status: active plain, left in red, on leave and suspended in amber. */
export function StatusChip({ status, label }: { status: string; label: string }) {
  const tone =
    status === 'active'
      ? 'border-line'
      : status === 'left'
        ? 'border-danger text-danger'
        : 'border-status-needs-action text-status-needs-action';
  return (
    <span className={`inline-block rounded-pill border px-2.5 py-0.5 text-caption ${tone}`}>
      {label}
    </span>
  );
}
