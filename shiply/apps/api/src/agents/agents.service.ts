import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { DB } from '../platform';

/** Who may work, and which agent a login belongs to. The one owner of agent people. */
@Injectable()
export class AgentsService {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  /** Approved, not blocked, and with an active agent. */
  async canWork(userId: string, tx: Tx | PrismaClient = this.db): Promise<boolean> {
    const p = await tx.person.findUnique({ where: { userId } });
    if (!p || p.status !== 'approved' || p.blocked) return false;
    const a = await tx.agent.findUnique({ where: { id: p.agentId } });
    return !!a?.active;
  }

  async assertCanWork(userId: string, tx: Tx | PrismaClient = this.db) {
    if (!(await this.canWork(userId, tx))) throw new HttpException({ error: 'person_cannot_work' }, 400);
  }

  personOf(userId: string) {
    return this.db.person.findUnique({ where: { userId } });
  }

  /** The agent an agent manager works for; 404 for anyone else. */
  async agentOfManager(userId: string) {
    const m = await this.db.agentManager.findUnique({ where: { userId } });
    if (!m) throw new HttpException({ error: 'not_found' }, 404);
    return m.agentId;
  }
}
