import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { DB, publish, SettingsService } from '../platform';

const PERSON_DOCS = ['national_id', 'driving_licence'];
const VEHICLE_DOCS = ['vehicle_licence', 'insurance'];

type Doc = { kind: string; personId: string | null; vehicleId: string | null; expiresAt: Date | null; createdAt: Date };

const day = (d: Date) => new Date(d.toISOString().slice(0, 10));

/** The newest document of a kind counts; it is valid when it never expires or expires today or later. */
function missing(docs: Doc[], kinds: string[], today: Date) {
  return kinds.filter((k) => {
    const latest = docs.filter((d) => d.kind === k).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return !latest || (latest.expiresAt !== null && latest.expiresAt < today);
  });
}

/** People without valid documents are blocked until fixed; fixed ones are unblocked. */
@Injectable()
export class ComplianceService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async check(now = new Date(), personIds?: string[]) {
    const today = day(now);
    const people = await this.db.person.findMany({ where: { status: 'approved', ...(personIds ? { id: { in: personIds } } : {}) } });
    const vehicles = await this.db.vehicle.findMany({ where: { active: true, personId: { in: people.map((p) => p.id) } } });
    const docs = await this.db.document.findMany({ where: { OR: [{ personId: { in: people.map((p) => p.id) } }, { vehicleId: { in: vehicles.map((v) => v.id) } }] } });
    let changed = 0;
    for (const p of people) {
      const gaps = missing(docs.filter((d) => d.personId === p.id), PERSON_DOCS, today);
      for (const v of vehicles.filter((x) => x.personId === p.id)) gaps.push(...missing(docs.filter((d) => d.vehicleId === v.id), VEHICLE_DOCS, today).map((k) => `${k} ${v.plate}`));
      const reason = gaps.length ? gaps.join(', ') : null;
      if (p.blocked === !!reason && p.blockedReason === reason) continue;
      await this.db.$transaction(async (tx) => {
        await tx.person.update({ where: { id: p.id }, data: { blocked: !!reason, blockedReason: reason } });
        if (reason && !p.blocked) await publish(tx, 'agents.person_blocked', { personId: p.id, userId: p.userId, reason }, `agents.person_blocked:${p.id}:${now.getTime()}`);
      });
      changed += 1;
    }
    return { checked: people.length, changed };
  }

  /** Documents already expired, and those expiring within the warning days. */
  async report(now = new Date()) {
    const today = day(now);
    const days = await this.settings.get<number>('agents.expiry_warning_days');
    const until = new Date(today.getTime() + days * 86_400_000);
    const [expired, expiring] = await Promise.all([
      this.db.document.findMany({ where: { expiresAt: { lt: today } }, orderBy: { expiresAt: 'asc' } }),
      this.db.document.findMany({ where: { expiresAt: { gte: today, lte: until } }, orderBy: { expiresAt: 'asc' } }),
    ]);
    return { expired, expiring, days };
  }

  async expiringCount(now = new Date()) {
    return (await this.report(now)).expiring.length;
  }
}

/** Checks every person once an hour (from main.ts). */
export function startComplianceWorker(compliance: ComplianceService, everyMs = 3_600_000) {
  const timer = setInterval(() => void compliance.check().catch((err) => console.error('compliance', err)), everyMs);
  return () => clearInterval(timer);
}
