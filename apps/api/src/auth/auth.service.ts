import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isMerchantRole, isStaffRole, Role } from '@shiply/shared';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AppName, JwtPayload, RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

/** Which roles may sign in to which app. The two driver apps never share a login. */
export function roleAllowedInApp(role: Role, app: AppName): boolean {
  switch (app) {
    case 'merchant':
      return isMerchantRole(role);
    case 'ops':
      return isStaffRole(role);
    case 'pickup':
      return role === 'PICKUP_DRIVER';
    case 'delivery':
      return role === 'DELIVERY_DRIVER';
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, app: AppName, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || user.archived || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!roleAllowedInApp(user.role as Role, app)) {
      throw new ForbiddenException(`This account cannot sign in to the ${app} app`);
    }
    const tokens = await this.issue(user, app);
    await this.prisma.asSystem(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, { ...ctxOf(user), ip }, { action: 'auth.login', entityType: 'user', entityId: user.id, after: { app } });
    });
    return { ...tokens, user: publicUser(user) };
  }

  async refresh(refreshToken: string) {
    const hash = sha256(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!row || row.revokedAt || row.expiresAt < new Date() || row.user.archived) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Rotation: the old token is revoked and a new pair is issued.
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    const tokens = await this.issue(row.user, row.app as AppName);
    return { ...tokens, user: publicUser(row.user) };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let merchant = null;
    if (user.merchantId) {
      merchant = await this.prisma.withContext(ctxOf(user), (tx) =>
        tx.merchant.findUnique({ where: { id: user.merchantId! } }),
      );
    }
    return { user: publicUser(user), merchant };
  }

  async setLanguage(ctx: RequestContext, language: 'en' | 'ar') {
    return this.prisma.withContext(ctx, async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId! } });
      const user = await tx.user.update({ where: { id: ctx.userId! }, data: { language } });
      await this.audit.record(tx, ctx, {
        action: 'user.language',
        entityType: 'user',
        entityId: user.id,
        before: { language: before.language },
        after: { language },
      });
      return publicUser(user);
    });
  }

  private async issue(user: UserRow, app: AppName) {
    const ttl = await this.config.getInt('auth.access_token_ttl_seconds');
    const refreshDays = await this.config.getInt('auth.refresh_token_ttl_days');
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role as Role,
      mid: user.merchantId,
      fid: user.franchiseId,
      lang: user.language as 'en' | 'ar',
      app,
    };
    const accessToken = await this.jwt.signAsync(payload, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: ttl });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        app,
        expiresAt: new Date(Date.now() + refreshDays * 86400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: ttl };
  }
}

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  language: string;
  merchantId: string | null;
  franchiseId: string | null;
  hubId: string | null;
  archived: boolean;
};

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    language: u.language,
    merchantId: u.merchantId,
    franchiseId: u.franchiseId,
    hubId: u.hubId,
  };
}

function ctxOf(u: UserRow): RequestContext {
  const merchant = isMerchantRole(u.role as Role);
  return {
    userId: u.id,
    role: u.role as Role,
    merchantId: merchant ? u.merchantId : null,
    franchiseId: u.franchiseId,
    bypassRls: false,
    language: u.language as 'en' | 'ar',
  };
}

