export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} aria-hidden="true" className="icon">
      <use href={`/brand/icons.svg#shiply-${name}`} />
    </svg>
  );
}
