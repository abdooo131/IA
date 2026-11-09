import { HttpException, Inject, Injectable } from '@nestjs/common';
import { verify } from 'argon2';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@shiply/db';
import { normalizeEgyptMobile, TILES, type AppId, type Level } from '@shiply/shared';
import { SettingsService } from '../settings/settings.service';
import { DB } from '../tokens';
import type { SessionUser } from '../types';

interface TokenBody {
  sub: string;
  typ: 'session' | 'refresh';
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Email (any letter case) or Egyptian mobile in any form. */
  private where(login: string) {
    const trimmed = login.trim();
    if (trimmed.includes('@')) return { email: trimmed.toLowerCase() };
    const mobile = normalizeEgyptMobile(trimmed);
    return mobile ? { mobile } : null;
  }

  async login(login: string, password: string): Promise<string> {
    const where = this.where(login);
    const user = where ? await this.db.user.findFirst({ where: { ...where, active: true } }) : null;
    if (!user) throw new HttpException({ error: 'wrong_login' }, 401);
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new HttpException({ error: 'locked' }, 429);
    if (!(await verify(user.passwordHash, password))) {
      const max = await this.settings.get<number>('auth.max_failed_logins');
      const minutes = await this.settings.get<number>('auth.lockout_minutes');
      const failed = user.failedLogins + 1;
      await this.db.user.update({
        where: { id: user.id },
        data:
          failed >= max
            ? { failedLogins: 0, lockedUntil: new Date(Date.now() + minutes * 60_000) }
            : { failedLogins: failed },
      });
      throw new HttpException({ error: 'wrong_login' }, 401);
    }
    if (user.failedLogins || user.lockedUntil) {
      await this.db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    return user.id;
  }

  async tokens(userId: string) {
    const sessionMinutes = await this.settings.get<number>('auth.session_minutes');
    const refreshDays = await this.settings.get<number>('auth.refresh_days');
    return {
      sid: jwt.sign({ sub: userId, typ: 'session' } satisfies TokenBody, secret(), { expiresIn: sessionMinutes * 60 }),
      rid: jwt.sign({ sub: userId, typ: 'refresh' } satisfies TokenBody, secret(), { expiresIn: refreshDays * 86400 }),
      sessionMs: sessionMinutes * 60_000,
      refreshMs: refreshDays * 86_400_000,
    };
  }

  /** The user id inside a valid token of the given type, or null. */
  read(token: string | undefined, typ: TokenBody['typ']): string | null {
    if (!token) return null;
    try {
      const body = jwt.verify(token, secret()) as TokenBody;
      return body.typ === typ ? body.sub : null;
    } catch {
      return null;
    }
  }

  async sessionUser(userId: string): Promise<SessionUser | null> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { role: { include: { access: true } } },
    });
    if (!user || !user.active) return null;
    const access = Object.fromEntries(TILES.map((t) => [t, 'none'])) as Record<AppId, Level>;
    for (const a of user.role.access) if ((TILES as readonly string[]).includes(a.app)) access[a.app as AppId] = a.level as Level;
    return { id: user.id, kind: user.kind, access };
  }
}
