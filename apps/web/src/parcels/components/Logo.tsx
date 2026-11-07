// The brand logo files (public/brand) are used as they are. The mark always points forward,
// in Arabic too (never mirrored).
export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const h = size === 'lg' ? 'h-9' : 'h-7';
  return (
    <span className={`inline-flex items-center ${h}`} dir="ltr">
      <img
        src="/brand/logo-horizontal-primary.svg"
        alt="Shiply"
        className={`logo-light ${h} w-auto`}
      />
      <img
        src="/brand/logo-horizontal-reverse.svg"
        alt="Shiply"
        className={`logo-dark ${h} w-auto`}
      />
    </span>
  );
}

export function LogoOnColor() {
  return (
    <img src="/brand/logo-horizontal-reverse.svg" alt="Shiply" className="h-9 w-auto" dir="ltr" />
  );
}
