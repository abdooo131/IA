import type { PrismaClient, Tx } from '@shiply/db';

/** The sites (facilities, hubs, stores) a user works at. */
export async function sitesOf(db: PrismaClient | Tx, userId: string): Promise<string[]> {
  return (await db.userSite.findMany({ where: { userId }, select: { siteId: true } })).map((s) => s.siteId);
}

/** Logins of one kind (agent people for now), for other modules to list. */
export function peopleOfKind(db: PrismaClient | Tx, kind: 'agent_person' | 'staff') {
  return db.user.findMany({ where: { kind }, select: { id: true, name: true, nameAr: true, mobile: true, active: true }, orderBy: { name: 'asc' } });
}
