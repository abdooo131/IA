import type { PrismaClient, Tx } from '@shiply/db';

/** The sites (facilities, hubs, stores) a user works at. */
export async function sitesOf(db: PrismaClient | Tx, userId: string): Promise<string[]> {
  return (await db.userSite.findMany({ where: { userId }, select: { siteId: true } })).map((s) => s.siteId);
}
