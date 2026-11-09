// The 12 office apps (UI.md Step 1c) and the access levels.

export const TILES = [
  'shiply_now',
  'shiply',
  'merchants',
  'care',
  'location',
  'fleet',
  'purchasing',
  'accounting',
  'hr',
  'sales',
  'reports',
  'settings',
] as const;
export type AppId = (typeof TILES)[number];

export const LEVELS = ['none', 'view', 'use', 'manage'] as const;
export type Level = (typeof LEVELS)[number];

export function atLeast(have: Level, need: Level): boolean {
  return LEVELS.indexOf(have) >= LEVELS.indexOf(need);
}

export function isAppId(s: string): s is AppId {
  return (TILES as readonly string[]).includes(s);
}
