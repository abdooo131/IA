import { afterEach, describe, expect, it, vi } from 'vitest';
import { R2FileStore } from './file-store';

const config = {
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-never-sent',
  bucket: 'shiplynow-files',
};
const BASE = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;

/** Records each request R2FileStore makes and answers with the given responses in order. */
function fakeFetch(...answers: Response[]) {
  const seen: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: Request) => {
      seen.push(input);
      return Promise.resolve(answers.shift() ?? new Response(null, { status: 500 }));
    }),
  );
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('R2FileStore', () => {
  it('puts an object signed with SigV4 at the account endpoint, never sending the secret', async () => {
    const seen = fakeFetch(new Response(null, { status: 200 }));
    await new R2FileStore(config).put('photos/2026/11/abc', Buffer.from('hi'), 'image/jpeg');
    const req = seen[0]!;
    expect(req.method).toBe('PUT');
    expect(req.url).toBe(`${BASE}/photos/2026/11/abc`);
    expect(req.headers.get('content-type')).toBe('image/jpeg');
    expect(req.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/,
    );
    expect(JSON.stringify([...req.headers])).not.toContain(config.secretAccessKey);
  });

  it('reads an object back, and answers null for a missing one', async () => {
    fakeFetch(new Response(Buffer.from('bytes')), new Response(null, { status: 404 }));
    const store = new R2FileStore(config);
    expect((await store.get('photos/a'))?.toString()).toBe('bytes');
    expect(await store.get('photos/b')).toBeNull();
  });

  it('fails with the status only on an error', async () => {
    fakeFetch(new Response('<Error>AccessDenied</Error>', { status: 403 }));
    await expect(new R2FileStore(config).get('photos/a')).rejects.toThrow(
      'R2 get failed: HTTP 403',
    );
  });

  it('lists a prefix a page at a time', async () => {
    const seen = fakeFetch(
      new Response(
        `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
        <Contents><Key>photos/2026/11/a</Key><LastModified>2026-11-01T10:00:00.000Z</LastModified></Contents>
        <Contents><Key>photos/2026/11/b&amp;c</Key><LastModified>2026-11-02T10:00:00.000Z</LastModified></Contents>
        <NextContinuationToken>next+1</NextContinuationToken></ListBucketResult>`,
      ),
    );
    const page = await new R2FileStore(config).list('photos/');
    expect(seen[0]!.url).toBe(`${BASE}?list-type=2&prefix=photos%2F&max-keys=1000`);
    expect(page).toEqual({
      objects: [
        { key: 'photos/2026/11/a', lastModified: new Date('2026-11-01T10:00:00.000Z') },
        { key: 'photos/2026/11/b&c', lastModified: new Date('2026-11-02T10:00:00.000Z') },
      ],
      cursor: 'next+1',
    });
  });
});
