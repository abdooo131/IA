import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';

type Parcel = NonNullable<Awaited<ReturnType<PrismaClient['parcel']['findUnique']>>>;
import { atLeast } from '@shiply/shared';
import { DB, sitesOf, type SessionUser } from '../platform';

export interface ScanInput {
  step: string;
  code: string;
  deviceScanId: string;
  siteId?: string;
  clientAt?: Date;
  bagSeal?: string;
  runId?: string;
  pickupId?: string;
  carId?: string;
  /** courier steps */
  cash?: number;
  proof?: string;
  reason?: string;
}

export interface ScanAnswer {
  ok: boolean;
  colour: 'green' | 'amber' | 'red';
  /** shown in big letters: the hub, the zone, a count */
  big: string;
  small?: string;
  reason?: string;
  parcelId?: string;
  bagId?: string;
}

export interface StepContext {
  input: ScanInput;
  user: SessionUser;
  /** the parcel whose tracking number was scanned, when the code is one */
  parcel: Parcel | null;
}

export type StepHandler = (tx: Tx, ctx: StepContext) => Promise<ScanAnswer>;

interface StepDef {
  handler: StepHandler;
  /** office or station steps need a site; courier steps do not */
  site: boolean;
  /** the code is a bag seal, not a parcel */
  codeIsBag?: boolean;
}

const steps = new Map<string, StepDef>();

/** Each part of the network flow registers the scans it understands. */
export function registerStep(step: string, def: StepDef) {
  steps.set(step, def);
}

const red = (reason: string, big = reason): ScanAnswer => ({ ok: false, colour: 'red', big, reason });

/** One route for every scan. A resent scan (same deviceScanId) gets the first answer and changes nothing. */
@Injectable()
export class ScanService {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  async scan(input: ScanInput, user: SessionUser): Promise<ScanAnswer> {
    const seen = await this.db.scan.findUnique({ where: { deviceScanId: input.deviceScanId } });
    if (seen) return seen.answer as unknown as ScanAnswer;
    const def = steps.get(input.step);
    const code = input.code.trim().toUpperCase();
    let parcel: Parcel | null = null;
    let answer: ScanAnswer;
    try {
      if (!def) throw new HttpException({ error: 'unknown_step' }, 400);
      await this.checkWho(def, input, user);
      if (!def.codeIsBag) {
        parcel = await this.db.parcel.findUnique({ where: { tracking: code } });
        if (!parcel) throw new HttpException({ error: 'not_found' }, 404);
      }
      answer = await this.db.$transaction(async (tx) => {
        // Claim the device scan first: a resend at the same moment waits here and then fails.
        const row = await tx.scan.create({ data: this.row(input, code, user, parcel?.id ?? null, { ok: true, colour: 'green', big: '' }) });
        const a = await def.handler(tx, { input: { ...input, code }, user, parcel });
        await tx.scan.update({ where: { id: row.id }, data: { ok: a.ok, reason: a.reason ?? null, answer: a as object, bagId: a.bagId ?? null, parcelId: a.parcelId ?? parcel?.id ?? null } });
        return a;
      });
    } catch (err) {
      const again = await this.db.scan.findUnique({ where: { deviceScanId: input.deviceScanId } });
      if (again) return again.answer as unknown as ScanAnswer;
      if (!(err instanceof HttpException)) throw err;
      const body = err.getResponse() as { error?: string };
      answer = red(body.error ?? 'refused');
      if (parcel) answer.parcelId = parcel.id;
      try {
        await this.db.scan.create({ data: this.row(input, code, user, parcel?.id ?? null, answer) });
      } catch {
        const stored = await this.db.scan.findUnique({ where: { deviceScanId: input.deviceScanId } });
        if (stored) return stored.answer as unknown as ScanAnswer;
      }
    }
    return answer;
  }

  private row(input: ScanInput, code: string, user: SessionUser, parcelId: string | null, a: ScanAnswer) {
    return { deviceScanId: input.deviceScanId, step: input.step, code, parcelId, siteId: input.siteId ?? null, userId: user.id, ok: a.ok, reason: a.reason ?? null, answer: a as object, clientAt: input.clientAt ?? null };
  }

  /** For routes outside a scan: the same rule as a station step. */
  async assertSite(user: SessionUser, siteId: string) {
    await this.checkWho({ site: true, handler: async () => red('x') }, { step: '', code: '', deviceScanId: '', siteId }, user);
  }

  /** Station steps: shiply use and working at that site (supervisors with manage, anywhere). Courier steps: agent people only. */
  private async checkWho(def: StepDef, input: ScanInput, user: SessionUser) {
    if (!def.site) {
      if (user.kind !== 'agent_person') throw new HttpException({ error: 'couriers_only' }, 403);
      return;
    }
    if (!input.siteId) throw new HttpException({ error: 'site_required' }, 400);
    if (!atLeast(user.access.shiply, 'use')) throw new HttpException({ error: 'no_access' }, 403);
    if (!atLeast(user.access.shiply, 'manage') && !(await sitesOf(this.db, user.id)).includes(input.siteId)) throw new HttpException({ error: 'not_your_site' }, 403);
  }
}
