import { photoUrl } from '@/lib/hr-types';

const SIZES = {
  xs: 'h-7 w-7 text-[11px]',
  sm: 'h-9 w-9 text-caption',
  md: 'h-12 w-12 text-body-sm',
  lg: 'h-20 w-20 text-h3',
  xl: 'h-28 w-28 text-h2',
} as const;

/** Two letters for a person without a photo (Arabic names keep their first letters too). */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0]];
  return letters.join('').toUpperCase();
}

/** A soft background picked from the name, so the same person always has the same color. */
function tone(name: string) {
  // Brand v2 pairs only (each checked for contrast in the tokens).
  const tones = [
    'bg-selected-bg text-link',
    'bg-hero text-hero-ink',
    'bg-accent text-on-accent',
    'bg-surface-raised text-text',
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tones[h % tones.length]!;
}

/**
 * A person's round photo, or their initials when they have none. `src` overrides the address
 * (My HR reads its own photo from /api/me/employee/photo).
 */
export function Avatar({
  employeeId,
  photoVersion,
  name,
  size = 'sm',
  src,
  className = '',
}: {
  employeeId: string;
  photoVersion: number | null;
  name: string;
  size?: keyof typeof SIZES;
  src?: string | null;
  className?: string;
}) {
  const url = src === undefined ? photoUrl(employeeId, photoVersion) : src;
  const box = `${SIZES[size]} shrink-0 rounded-full ${className}`;
  if (url)
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className={`${box} border border-line bg-surface-raised object-cover`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`${box} ${tone(name)} flex select-none items-center justify-center font-bold`}
    >
      {initials(name)}
    </span>
  );
}
