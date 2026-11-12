import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, type User, verifyPassword } from '@shiplynow/db';
import type { AccessTokenClaims, LoginInput, PublicUser } from '@shiplynow/shared';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const invalidCredentials = () => new UnauthorizedException({ error: 'invalid_credentials' });
const invalidRefresh = () => new UnauthorizedException({ error: 'invalid_refresh_token' });

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role };
}

@Injectable()
export class AuthService {
  /** Compared against when the email is unknown, so a miss costs the same time as a hit. */
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(input: LoginInput): Promise<{ user: User; tokens: IssuedTokens }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await verifyPassword(await this.dummyHash, input.password);
      throw invalidCredentials();
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw invalidCredentials();
    if (!user.isActive) {
      // Only someone who knows the password learns that a sign up is waiting or refused.
      const merchant = user.merchantId
        ? await this.prisma.merchant.findUnique({ where: { id: user.merchantId } })
        : null;
      if (merchant?.approval === 'pending')
        throw new ForbiddenException({ error: 'account_pending' });
      if (merchant?.approval === 'rejected')
        throw new ForbiddenException({ error: 'account_rejected' });
      throw invalidCredentials();
    }

    return { user, tokens: await this.issueTokens(user) };
  }

  /**
   * Rotates a refresh token. Presenting an already revoked token is treated as theft:
   * every refresh token of that user is revoked and they must sign in again.
   */
  async refresh(presented: string): Promise<{ user: User; tokens: IssuedTokens }> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(presented) },
      include: { user: true },
    });
    if (!stored) throw invalidRefresh();

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw invalidRefresh();
    }
    if (stored.expiresAt <= new Date() || !stored.user.isActive) throw invalidRefresh();

    return this.prisma.$transaction(async (tx) => {
      // Conditional update so two concurrent refreshes with the same token cannot both win.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw invalidRefresh();
      return { user: stored.user, tokens: await this.issueTokens(stored.user, tx) };
    });
  }

  async logout(presented: string | undefined): Promise<void> {
    if (!presented) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async findActiveUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive) throw new UnauthorizedException({ error: 'unauthenticated' });
    return user;
  }

  private async issueTokens(
    user: User,
    db: Pick<PrismaService, 'refreshToken'> = this.prisma,
  ): Promise<IssuedTokens> {
    const accessTokenExpiresIn = this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    const refreshDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });

    const claims: AccessTokenClaims = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: accessTokenExpiresIn });

    const refreshToken = randomBytes(32).toString('base64url');
    const refreshTokenExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
      },
    });

    return { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt };
  }
}
