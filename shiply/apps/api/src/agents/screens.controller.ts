import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@shiply/db';
import { LocationService } from '../location';
import { CashService } from '../money';
import { DB, loginsInfo, NeedAccess } from '../platform';
import { AgentsService } from './agents.service';
import { ComplianceService } from './compliance.service';

/** What the Fleet screens and the agent's own screen read. */
@Controller('agents')
export class ScreensController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(LocationService) private readonly location: LocationService,
    @Inject(CashService) private readonly cash: CashService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
  ) {}

  @Get('lookups')
  @NeedAccess('fleet', 'view')
  async lookups() {
    const [agents, sites, people] = await Promise.all([this.db.agent.findMany({ orderBy: { code: 'asc' } }), this.location.sites(), this.db.person.findMany({ select: { id: true, userId: true, agentId: true } })]);
    const users = await loginsInfo(this.db, people.map((p) => p.userId));
    return {
      agents: agents.map((a) => ({ id: a.id, code: a.code, name: a.name, nameAr: a.nameAr, active: a.active })),
      sites: sites.filter((s) => s.active),
      people: people.map((p) => ({ ...p, name: users.find((u) => u.id === p.userId)?.name ?? '', nameAr: users.find((u) => u.id === p.userId)?.nameAr ?? '' })),
    };
  }

  /** The agent manager's screen: his people, vehicles, documents to renew and the cash his people hold. */
  @Get('me/overview')
  async overview(@Req() req: Request) {
    const agentId = await this.agents.agentOfManager(req.user!.id);
    const [agent, people, vehicles] = await Promise.all([this.db.agent.findUniqueOrThrow({ where: { id: agentId } }), this.db.person.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } }), this.db.vehicle.findMany({ where: { agentId } })]);
    const users = await loginsInfo(this.db, people.map((p) => p.userId));
    const report = await this.compliance.report();
    const mineDoc = (d: { personId: string | null; vehicleId: string | null }) => people.some((p) => p.id === d.personId) || vehicles.some((v) => v.id === d.vehicleId);
    const rows = await Promise.all(
      people.map(async (p) => {
        const u = users.find((x) => x.id === p.userId);
        return { id: p.id, role: p.role, status: p.status, blocked: p.blocked, blockedReason: p.blockedReason, name: u?.name ?? '', nameAr: u?.nameAr ?? '', mobile: u?.mobile ?? null, cashHeld: (await this.cash.heldBy('courier', p.userId)) + (await this.cash.heldBy('rider', p.userId)) };
      }),
    );
    return { agent: { id: agent.id, code: agent.code, name: agent.name, nameAr: agent.nameAr }, people: rows, vehicles, expired: report.expired.filter(mineDoc), expiring: report.expiring.filter(mineDoc) };
  }
}
