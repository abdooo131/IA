import { HttpException } from '@nestjs/common';
import { hash } from 'argon2';
import type { Tx } from '@shiply/db';
import { normalizeEgyptMobile } from '@shiply/shared';

export interface NewLogin {
  name: string;
  nameAr: string;
  email?: string;
  mobile?: string;
  password: string;
  kind: 'staff' | 'agent_person' | 'agent_manager' | 'merchant_user';
  roleKey: string;
}

/** Creates a login for another module (merchant users, agent people). Platform owns the users. */
export async function createLogin(tx: Tx, input: NewLogin): Promise<{ id: string }> {
  const email = input.email?.trim().toLowerCase() || undefined;
  let mobile: string | undefined;
  if (input.mobile) {
    mobile = normalizeEgyptMobile(input.mobile) ?? undefined;
    if (!mobile) throw new HttpException({ error: 'invalid_mobile' }, 400);
  }
  if (!email && !mobile) throw new HttpException({ error: 'login_required' }, 400);
  const role = await tx.jobRole.findUnique({ where: { key: input.roleKey } });
  if (!role) throw new HttpException({ error: 'unknown_role' }, 400);
  const taken = await tx.user.findFirst({ where: { OR: [...(email ? [{ email }] : []), ...(mobile ? [{ mobile }] : [])] } });
  if (taken) throw new HttpException({ error: 'login_taken' }, 409);
  const user = await tx.user.create({
    data: { name: input.name, nameAr: input.nameAr, email, mobile, kind: input.kind, roleId: role.id, passwordHash: await hash(input.password) },
    select: { id: true },
  });
  return user;
}

/** Switches logins on or off; switching off also ends their sessions. */
export async function setLoginsActive(tx: Tx, userIds: string[], active: boolean) {
  if (!userIds.length) return;
  await tx.user.updateMany({ where: { id: { in: userIds } }, data: active ? { active } : { active, tokenVersion: { increment: 1 } } });
}
