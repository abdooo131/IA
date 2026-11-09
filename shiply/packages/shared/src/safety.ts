// Small safety checks used by the API and the web app.

/**
 * Where login may send the user afterwards: only a page of this site, under /en/ or /ar/.
 * Anything that a browser could read as another address (//x, /\x, tabs, encoded tricks) is refused.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return null;
  if (!/^\/(en|ar)(\/|$|\?)/.test(next)) return null;
  return next;
}

/** The login token secret: required, at least 32 characters, never the example value. */
export function assertJwtSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32 || secret.startsWith('change-me')) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters');
  }
  return secret;
}
