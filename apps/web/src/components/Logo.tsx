// Plain img tags: the logo files are the guide's logo (public/brand, traced from the brand v2
// artwork) and must not be altered. Light theme: Shiply Blue mark with a Navy wordmark. Dark
// theme and Navy or Blue grounds: Lime mark with a white wordmark. The mark always points
// forward, in Arabic too (never mirrored).

export function Logo({ alt, size = 'md' }: { alt: string; size?: 'md' | 'lg' }) {
  const h = size === 'lg' ? 'h-9' : 'h-7';
  return (
    <span className={`inline-flex items-center ${h}`} dir="ltr">
      <img
        src="/brand/logo-horizontal-primary.svg"
        alt={alt}
        className={`logo-light ${h} w-auto`}
      />
      <img src="/brand/logo-horizontal-reverse.svg" alt={alt} className={`logo-dark ${h} w-auto`} />
    </span>
  );
}

/** The logo for a Navy or Shiply Blue brand panel, whatever the theme. */
export function LogoOnColor({ alt }: { alt: string }) {
  return (
    <img src="/brand/logo-horizontal-reverse.svg" alt={alt} className="h-9 w-auto" dir="ltr" />
  );
}
