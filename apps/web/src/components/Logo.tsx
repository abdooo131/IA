// Plain img tags: the logo files are fixed SVGs from the brand handoff and must not be altered.

export function Logo({ alt }: { alt: string }) {
  return (
    <span className="inline-flex h-7 items-center">
      <img src="/brand/logo-horizontal-primary.svg" alt={alt} className="logo-light h-7 w-auto" />
      <img src="/brand/logo-horizontal-reverse.svg" alt={alt} className="logo-dark h-7 w-auto" />
    </span>
  );
}
