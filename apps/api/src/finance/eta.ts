import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { recordEtaResult, signedDocument } from '@shiplynow/db';
import type { EtaObject } from '@shiplynow/shared';
import { ErrorReporter } from '../common/error-reporter';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface EtaSubmission {
  submissionId: string;
  accepted: { uuid: string; longId: string; internalId: string }[];
  rejected: { internalId: string; error: unknown }[];
}

export type EtaDocumentStatus = 'Submitted' | 'Valid' | 'Invalid' | 'Rejected' | 'Cancelled';

/**
 * Everything we ask of the Egyptian Tax Authority's e-invoice system goes through this
 * boundary: tests use a fake, and nothing is sent while it is not configured.
 */
export abstract class EtaClient {
  abstract readonly enabled: boolean;
  abstract submit(documents: EtaObject[]): Promise<EtaSubmission>;
  abstract status(uuid: string): Promise<{ status: EtaDocumentStatus; errors?: unknown }>;
}

const HOSTS = {
  preprod: {
    id: 'https://id.preprod.eta.gov.eg',
    api: 'https://api.preprod.invoicing.eta.gov.eg',
  },
  production: { id: 'https://id.eta.gov.eg', api: 'https://api.invoicing.eta.gov.eg' },
};

@Injectable()
export class HttpEtaClient extends EtaClient {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly hosts: (typeof HOSTS)['preprod'];
  private token: { value: string; until: number } | null = null;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.clientId = config.get('ETA_CLIENT_ID', { infer: true }) || undefined;
    this.clientSecret = config.get('ETA_CLIENT_SECRET', { infer: true }) || undefined;
    this.hosts =
      HOSTS[config.get('ETA_ENV', { infer: true }) === 'production' ? 'production' : 'preprod'];
  }

  get enabled() {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async accessToken() {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const res = await fetch(`${this.hosts.id}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId!,
        client_secret: this.clientSecret!,
        scope: 'InvoicingAPI',
      }),
    });
    if (!res.ok) throw new Error(`eta_login_${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    // Renew a minute before it runs out.
    this.token = { value: data.access_token, until: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  }

  async submit(documents: EtaObject[]): Promise<EtaSubmission> {
    const res = await fetch(`${this.hosts.api}/api/v1/documentsubmissions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await this.accessToken()}`,
      },
      body: JSON.stringify({ documents }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      submissionId?: string;
      acceptedDocuments?: { uuid: string; longId: string; internalId: string }[];
      rejectedDocuments?: { internalId: string; error: unknown }[];
      error?: unknown;
    };
    if (!res.ok && !data.rejectedDocuments)
      throw new Error(
        `eta_submit_${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 300)}`,
      );
    return {
      submissionId: data.submissionId ?? '',
      accepted: data.acceptedDocuments ?? [],
      rejected: data.rejectedDocuments ?? [],
    };
  }

  async status(uuid: string) {
    const res = await fetch(`${this.hosts.api}/api/v1/documents/${uuid}/details`, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok) throw new Error(`eta_status_${res.status}`);
    const data = (await res.json()) as { status: EtaDocumentStatus; validationResults?: unknown };
    return { status: data.status, errors: data.validationResults };
  }
}

const EVERY_MS = 60_000;
/** How long ETA usually takes to validate a submitted document before we ask. */
const CHECK_AFTER_MS = 30_000;

/**
 * Sends signed documents to ETA and asks for the result of submitted ones, every minute
 * and only when ETA is configured. Safe to run twice: a document leaves "signed" only
 * once ETA has answered for it.
 */
@Injectable()
export class EtaSync implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('ETA');
  private timer?: NodeJS.Timeout;
  private current?: Promise<{ submitted: number; checked: number } | null>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eta: EtaClient,
    private readonly config: ConfigService<Env, true>,
    private readonly reporter: ErrorReporter,
  ) {}

  onApplicationBootstrap() {
    const setting = this.config.get('JOBS_ENABLED', { infer: true });
    const enabled = setting
      ? setting === 'true'
      : this.config.get('NODE_ENV', { infer: true }) !== 'test';
    if (!enabled || !this.eta.enabled) return;
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One run at a time; a call while one is going waits for it instead of skipping. */
  run() {
    if (!this.eta.enabled) return Promise.resolve(null);
    this.current ??= this.runOnce().finally(() => {
      this.current = undefined;
    });
    return this.current;
  }

  private async runOnce() {
    try {
      return { submitted: await this.submitSigned(), checked: await this.checkSubmitted() };
    } catch (error) {
      await this.reporter.report('job: e-invoice', error);
      return null;
    }
  }

  async submitSigned() {
    const signed = await this.prisma.taxInvoice.findMany({
      where: { etaStatus: 'signed' },
      orderBy: [{ type: 'asc' }, { number: 'asc' }],
      take: 50,
    });
    if (signed.length === 0) return 0;
    const byInternal = new Map(
      signed.map((d) => [(d.document as { internalID?: string }).internalID ?? '', d]),
    );
    const result = await this.eta.submit(signed.map(signedDocument));
    for (const a of result.accepted) {
      const doc = byInternal.get(a.internalId);
      if (doc)
        await recordEtaResult(this.prisma, {
          id: doc.id,
          status: 'submitted',
          uuid: a.uuid,
          longId: a.longId,
          submissionId: result.submissionId,
        });
    }
    for (const r of result.rejected) {
      const doc = byInternal.get(r.internalId);
      if (doc)
        await recordEtaResult(this.prisma, { id: doc.id, status: 'rejected', error: r.error });
    }
    if (result.accepted.length || result.rejected.length)
      this.log.log(`Submitted ${result.accepted.length}, rejected ${result.rejected.length}`);
    return result.accepted.length;
  }

  async checkSubmitted() {
    const waiting = await this.prisma.taxInvoice.findMany({
      where: {
        etaStatus: 'submitted',
        etaUuid: { not: null },
        etaCheckedAt: { lt: new Date(Date.now() - CHECK_AFTER_MS) },
      },
      take: 50,
    });
    let checked = 0;
    for (const doc of waiting) {
      const answer = await this.eta.status(doc.etaUuid!);
      if (
        answer.status === 'Valid' ||
        answer.status === 'Invalid' ||
        answer.status === 'Rejected'
      ) {
        await recordEtaResult(this.prisma, {
          id: doc.id,
          status:
            answer.status === 'Valid'
              ? 'valid'
              : answer.status === 'Invalid'
                ? 'invalid'
                : 'rejected',
          error: answer.status === 'Valid' ? undefined : (answer.errors ?? null),
        });
        checked++;
      } else
        await this.prisma.taxInvoice.update({
          where: { id: doc.id },
          data: { etaCheckedAt: new Date() },
        });
    }
    return checked;
  }
}
