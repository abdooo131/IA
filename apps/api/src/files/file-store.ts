import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbFileStore, type FileStore as FileStoreShape, type StoredObject } from '@shiplynow/db';
import { AwsClient } from 'aws4fetch';
import type { Env } from '../config/env';
import { r2Config } from '../config/env';

/**
 * Where uploaded files are kept. The API picks R2 when its four settings are set, else the
 * database (today's behaviour); tests use FakeFileStore from @shiplynow/db. FilesModule hands
 * the chosen store to @shiplynow/db at start, so every domain function writes and reads through
 * it without being given it.
 */
export abstract class FileStore implements FileStoreShape {
  abstract readonly location: FileStoreShape['location'];
  abstract put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer | null>;
  delete?(key: string): Promise<void>;
  list?(
    prefix: string,
    cursor?: string,
  ): Promise<{ objects: StoredObject[]; cursor: string | null }>;
}

/** No object store: files stay in their rows. */
export class DatabaseFileStore extends FileStore {
  private readonly inner = new DbFileStore();
  readonly location = 'db' as const;
  put() {
    return this.inner.put();
  }
  get() {
    return this.inner.get();
  }
}

const TIMEOUT_MS = 30_000;

const unxml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Cloudflare R2 through its S3 compatible API (https://<account>.r2.cloudflarestorage.com),
 * signed with AWS Signature Version 4 by aws4fetch: a few kilobytes on top of Node's own fetch,
 * the client Cloudflare's R2 documentation shows, instead of the whole AWS SDK. The bucket is
 * private; nothing here makes a public or presigned link. Errors carry the HTTP status only,
 * never the keys or the signed request.
 */
export class R2FileStore extends FileStore {
  readonly location = 'r2' as const;
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(config: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    super();
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: 'auto',
      retries: 2,
    });
    this.base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  }

  private url(key: string) {
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async call(url: string, init: RequestInit, what: string) {
    const res = await this.client.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok && res.status !== 404) {
      await res.body?.cancel();
      throw new Error(`R2 ${what} failed: HTTP ${res.status}`);
    }
    return res;
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    const res = await this.call(
      this.url(key),
      {
        method: 'PUT',
        body: new Uint8Array(bytes),
        headers: { 'content-type': contentType, 'content-length': String(bytes.length) },
      },
      'put',
    );
    if (res.status === 404) throw new Error('R2 put failed: HTTP 404 (bucket not found)');
    await res.body?.cancel();
  }

  async get(key: string) {
    const res = await this.call(this.url(key), { method: 'GET' }, 'get');
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  }

  override async delete(key: string) {
    const res = await this.call(this.url(key), { method: 'DELETE' }, 'delete');
    await res.body?.cancel();
  }

  override async list(prefix: string, cursor?: string) {
    const query = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
    if (cursor) query.set('continuation-token', cursor);
    const res = await this.call(`${this.base}?${query.toString()}`, { method: 'GET' }, 'list');
    if (res.status === 404) throw new Error('R2 list failed: HTTP 404 (bucket not found)');
    const xml = await res.text();
    const objects: StoredObject[] = [];
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1];
      const at = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1]!)?.[1];
      if (key && at) objects.push({ key: unxml(key), lastModified: new Date(at) });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
    return { objects, cursor: truncated && next ? unxml(next) : null };
  }
}

/** The store the API uses: R2 when its four settings are set, else the database. */
@Injectable()
export class ConfiguredFileStore extends FileStore {
  private readonly log = new Logger('Files');
  private readonly inner: FileStore;

  constructor(config: ConfigService<Env, true>) {
    super();
    const r2 = r2Config({
      R2_ACCOUNT_ID: config.get('R2_ACCOUNT_ID', { infer: true }),
      R2_ACCESS_KEY_ID: config.get('R2_ACCESS_KEY_ID', { infer: true }),
      R2_SECRET_ACCESS_KEY: config.get('R2_SECRET_ACCESS_KEY', { infer: true }),
      R2_BUCKET: config.get('R2_BUCKET', { infer: true }),
    });
    this.inner = r2 ? new R2FileStore(r2) : new DatabaseFileStore();
    // Says where files go, never the account, keys or bucket.
    this.log.log(r2 ? 'Files are kept in Cloudflare R2' : 'Files are kept in the database');
  }

  get location() {
    return this.inner.location;
  }
  put(key: string, bytes: Buffer, contentType: string) {
    return this.inner.put(key, bytes, contentType);
  }
  get(key: string) {
    return this.inner.get(key);
  }
  override delete(key: string) {
    return this.inner.delete ? this.inner.delete(key) : Promise.resolve();
  }
  override list(prefix: string, cursor?: string) {
    return this.inner.list
      ? this.inner.list(prefix, cursor)
      : Promise.resolve({ objects: [], cursor: null });
  }
}
