// The "Our team" page's leadership cards come from a list in the `site.team.people` messages, so
// the owner's people are added by editing en.json and ar.json, never the component. A photo is an
// optional file under public/site/team/; without one the card shows the person's initials.

export interface TeamMember {
  name: string;
  role: string;
  summary: string;
  /** At most three, empty ones left out. */
  achievements: string[];
  /** A path under /site/team/, or null to show initials. */
  photo: string | null;
  /** Still the "[Name]" placeholder the owner has to replace. */
  placeholder: boolean;
}

export const MAX_ACHIEVEMENTS = 3;
const PHOTO = /^\/site\/team\/[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp|avif)$/i;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Reads the messages list; anything that is not a person with a name is left out. */
export function parseTeam(raw: unknown): TeamMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): TeamMember[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const person = entry as Record<string, unknown>;
    const name = text(person.name);
    if (!name) return [];
    const achievements = Array.isArray(person.achievements)
      ? person.achievements.map(text).filter(Boolean).slice(0, MAX_ACHIEVEMENTS)
      : [];
    const photo = text(person.photo);
    return [
      {
        name,
        role: text(person.role),
        summary: text(person.summary),
        achievements,
        photo: PHOTO.test(photo) && !photo.includes('..') ? photo : null,
        placeholder: name.startsWith('['),
      },
    ];
  });
}

/** One or two letters for the round photo spot: the first and last word's first letter. */
export function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return '?';
  const first = [...words[0]!][0]!;
  const last = words.length > 1 ? [...words[words.length - 1]!][0]! : '';
  return (first + last).toLocaleUpperCase();
}
