import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

/**
 * Everything the app asks of Shopify goes through this boundary, so tests and local runs
 * can swap in a simulated Shopify (see FakeShopify) without touching the services.
 */
export abstract class ShopifyAdmin {
  abstract graphql<T = Record<string, unknown>>(
    shop: string,
    token: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T>;

  /** The lines of a finished bulk export (JSON Lines at a signed Shopify address). */
  abstract downloadLines(url: string): AsyncIterable<string>;

  /** OAuth: trades the one time code from the install redirect for an offline token. */
  abstract exchangeCode(
    shop: string,
    code: string,
  ): Promise<{ accessToken: string; scope: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class HttpShopifyAdmin extends ShopifyAdmin {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async graphql<T>(
    shop: string,
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ) {
    const version = this.config.get('SHOPIFY_API_VERSION', { infer: true });
    // Throttling and server errors are retried with growing waits; anything else is final.
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        if (attempt < 3) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new ShopifyApiError(`network: ${(error as Error).message}`, true);
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 3) {
          await sleep(Number(res.headers.get('retry-after') ?? 0) * 1000 || 500 * 2 ** attempt);
          continue;
        }
        throw new ShopifyApiError(`http ${res.status}`, true);
      }
      const body = (await res.json().catch(() => ({}))) as {
        data?: T;
        errors?: { message: string; extensions?: { code?: string } }[];
      };
      if (res.status === 401 || res.status === 403)
        throw new ShopifyApiError(`http ${res.status}`, false);
      if (body.errors?.length) {
        const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && attempt < 3) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ShopifyApiError(body.errors.map((e) => e.message).join('; '), throttled);
      }
      if (!body.data)
        throw new ShopifyApiError(`http ${res.status} without data`, res.status >= 500);
      return body.data;
    }
  }

  /** Streams the file line by line, so a store's whole history never sits in memory at once. */
  async *downloadLines(url: string) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new ShopifyApiError(`bulk download http ${res.status}`, true);
    const decoder = new TextDecoder();
    let rest = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      rest += decoder.decode(chunk, { stream: true });
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) yield line;
    }
    rest += decoder.decode();
    if (rest.trim()) yield rest;
  }

  async exchangeCode(shop: string, code: string) {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.get('SHOPIFY_API_KEY', { infer: true }),
        client_secret: this.config.get('SHOPIFY_API_SECRET', { infer: true }),
        code,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string };
    if (!res.ok || !body.access_token)
      throw new ShopifyApiError(`token exchange failed (${res.status})`, false);
    return { accessToken: body.access_token, scope: body.scope ?? '' };
  }
}

/** "1249.50" (Shopify money string) to integer piastres, without floats. */
export function moneyToPiastres(amount: string | null | undefined): number {
  if (!amount) return 0;
  const match = /^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/.exec(amount.trim());
  if (!match) return 0;
  const value = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? 0 - value : value;
}

/** Throws when a mutation answered with user errors, naming the operation. */
export function assertNoUserErrors(
  operation: string,
  result: { userErrors?: { message: string }[] } | null | undefined,
) {
  if (result?.userErrors?.length)
    throw new ShopifyApiError(
      `${operation}: ${result.userErrors.map((e) => e.message).join('; ')}`,
      false,
    );
}
