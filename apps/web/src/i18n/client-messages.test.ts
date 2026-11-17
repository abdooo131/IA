import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { clientNeeds, covers, sourceFiles } from './client-graph';
import { CLIENT_SCOPES, type ClientScope, pickMessages } from './client-messages';

const APP = path.resolve(__dirname, '../app');

/** The route files each scope's provider wraps. */
const ENTRIES: Record<ClientScope, string[]> = {
  root: ['app/layout.tsx', 'app/error.tsx', 'app/not-found.tsx', 'app/global-error.tsx'],
  site: ['app/page.tsx', 'app/contact', 'app/how-it-works', 'app/solutions', 'app/team'],
  ...(Object.fromEntries(
    Object.keys(CLIENT_SCOPES)
      .filter((s) => s !== 'root' && s !== 'site')
      .map((s) => [s, [`app/${s}`]]),
  ) as Record<Exclude<ClientScope, 'root' | 'site'>, string[]>),
};
const SITE_FOLDERS = ['contact', 'how-it-works', 'solutions', 'team'];
const scopes = Object.keys(CLIENT_SCOPES) as ClientScope[];
const size = (scope: ClientScope, messages: Record<string, unknown>) =>
  Buffer.byteLength(JSON.stringify(pickMessages(messages, CLIENT_SCOPES[scope])));

describe('translations sent to the browser', () => {
  it.each(scopes)(
    'scope %s sends every namespace its client components use, and no other',
    (scope) => {
      const needs = clientNeeds(ENTRIES[scope]);
      expect(needs.unclear).toEqual([]);
      const picked: readonly string[] = CLIENT_SCOPES[scope];
      const missing = [...needs.namespaces].filter((ns) => !covers(picked, ns));
      expect(missing, `add to CLIENT_SCOPES.${scope}`).toEqual([]);
      const unused = picked.filter((p) => ![...needs.namespaces].some((ns) => covers([p], ns)));
      expect(unused, `remove from CLIENT_SCOPES.${scope}`).toEqual([]);
      // No entry inside another one (the picked parts never overlap).
      expect(
        picked.filter((p) =>
          covers(
            picked.filter((q) => q !== p),
            p,
          ),
        ),
      ).toEqual([]);
    },
  );

  it('names only namespaces that exist in both languages', () => {
    for (const scope of scopes)
      for (const ns of CLIENT_SCOPES[scope]) {
        const has = (m: unknown) =>
          ns.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], m);
        expect(has(en), `${scope}: ${ns}`).toBeDefined();
        expect(has(ar), `${scope}: ${ns}`).toBeDefined();
      }
  });

  it('wraps every route folder in its scope', () => {
    const read = (f: string) => fs.readFileSync(path.join(APP, f), 'utf8');
    expect(read('layout.tsx')).toContain('<ClientMessages scope="root">');
    expect(read('layout.tsx')).not.toContain('NextIntlClientProvider');
    expect(read('page.tsx').match(/<ClientMessages scope="site">/g)?.length).toBe(2);
    for (const folder of fs.readdirSync(APP, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const scope = SITE_FOLDERS.includes(folder.name) ? 'site' : folder.name;
      if (!(scope in CLIENT_SCOPES)) {
        // Only route handlers (/api, /auth) live outside a scope: no page or component.
        expect(
          sourceFiles(`app/${folder.name}`).filter((f) => f.endsWith('.tsx')),
          folder.name,
        ).toEqual([]);
        continue;
      }
      expect(read(`${folder.name}/layout.tsx`), folder.name).toContain(
        `<ClientMessages scope="${scope}">`,
      );
    }
  });

  it('keeps the phone and public pages light, and the SOP texts on the server', () => {
    const whole = Buffer.byteLength(JSON.stringify(ar));
    for (const scope of ['root', 'site', 'rider', 't', 'p', 'login', 'signup', 'setup'] as const)
      expect(size(scope, ar), scope).toBeLessThan(whole / 20);
    expect(size('store', ar)).toBeLessThan(whole / 8);
    for (const scope of scopes) {
      expect(CLIENT_SCOPES[scope] as readonly string[]).not.toContain('sop');
      // The desk areas (admin, accounting) keep what their many screens use, still far from all.
      expect(size(scope, ar), scope).toBeLessThan((whole * 2) / 3);
    }
  });

  it('picks whole namespaces or parts of one', () => {
    const messages = { a: { b: { c: 'x' }, d: 'y' }, e: 'z', f: { g: 'w' } };
    expect(pickMessages(messages, ['a.b', 'e', 'missing', 'f.none'])).toEqual({
      a: { b: { c: 'x' } },
      e: 'z',
    });
  });
});
