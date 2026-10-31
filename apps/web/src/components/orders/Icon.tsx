/**
 * A Shiply brand icon (public/icons) drawn in the current text colour, via a CSS mask,
 * so icons follow the theme and the status colours.
 */
export function Icon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const url = `url(/icons/${name}.svg)`;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
      }}
    />
  );
}
