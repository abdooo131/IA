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

  /** OAuth: trades the one time code from the install redirect for an expiring offline token. */
  abstract exchangeCode(shop: string, code: string, app: AppCredentials): Promise<OfflineToken>;

  /** Trades the refresh token for a new access token and a new refresh token. */
  abstract refreshToken(
    shop: string,
    refreshToken: string,
    app: AppCredentials,
  ): Promise<OfflineToken>;

  /** One time: trades a shop's old non expiring token for an expiring one (the old one dies). */
  abstract migrateToken(
    shop: string,
    legacyToken: string,
    app: AppCredentials,
  ): Promise<OfflineToken>;
}

/** The app a store installed: the main app, or a custom app made for that merchant. */
export interface AppCredentials {
  clientId: string;
  secret: string;
}

/**
 * An offline token as Shopify answers it. Public apps get expiring ones: the access token
 * lasts about an hour, the refresh token 90 days (both renewed on every refresh).
 */
export interface OfflineToken {
  accessToken: string;
  scope: string;
  expiresIn?: number;
  refreshToken?: string;
  refreshTokenExpiresIn?: number;
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
      const text = await res.text().catch(() => '');
      let body: { data?: T; errors?: unknown } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        // Not JSON (an HTML error page): only the status and the text below are kept.
      }
      // Shopify's reason (for example a protected customer data refusal); never the token.
      if (res.status === 401 || res.status === 403)
        throw new ShopifyApiError(
          `http ${res.status}: ${(typeof body.errors === 'string' ? body.errors : text).slice(0, 300)}`,
          false,
        );
      if (typeof body.errors === 'string') throw new ShopifyApiError(body.errors, false);
      const errors = body.errors as
        { message: string; extensions?: { code?: string } }[] | undefined;
      if (errors?.length) {
        const throttled = errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && attempt < 3) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ShopifyApiError(errors.map((e) => e.message).join('; '), throttled);
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

  exchangeCode(shop: string, code: string, app: AppCredentials) {
    return this.tokenRequest(shop, app, { code, expiring: '1' }, 'token exchange');
  }

  refreshToken(shop: string, refreshToken: string, app: AppCredentials) {
    return this.tokenRequest(
      shop,
      app,
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      'token refresh',
    );
  }

  migrateToken(shop: string, legacyToken: string, app: AppCredentials) {
    return this.tokenRequest(
      shop,
      app,
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: legacyToken,
        subject_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        expiring: '1',
      },
      'token migration',
    );
  }

  /** POST to the shop's token endpoint with the app's credentials. Never logs a token. */
  private async tokenRequest(
    shop: string,
    app: AppCredentials,
    params: Record<string, string>,
    what: string,
  ): Promise<OfflineToken> {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.secret,
        ...params,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      scope?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      error?: string;
    };
    if (!res.ok || !body.access_token)
      throw new ShopifyApiError(
        `${what} failed (${res.status}${body.error ? ` ${body.error}` : ''})`,
        res.status >= 500,
      );
    return {
      accessToken: body.access_token,
      scope: body.scope ?? '',
      expiresIn: body.expires_in,
      refreshToken: body.refresh_token,
      refreshTokenExpiresIn: body.refresh_token_expires_in,
    };
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
