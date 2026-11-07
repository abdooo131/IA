import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyPassword } from '@shiply/db';
import type { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { CurrentUser, Public, SESSION_COOKIE, type SessionUser } from './auth';

const SESSION_HOURS = 12;
const LoginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

// A real hash of a random value, so unknown emails take as long as wrong passwords.
const DUMMY_HASH =
  'scrypt$c2hpcGx5c2hpcGx5c2hpcGx5$9YbqOxDJx7O4nbOKQ6cWnVUAP8iL7bH6O2Y3mB6Kq8w1x1n2R6QG3gVwA7m3U2xG7q1y0Rr1x4w1s2e3d4f5gQ==';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parse(LoginBody, body);
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) throw new DomainError('bad_login', 'Wrong email or password', 401);
    const token = await this.jwt.signAsync({ sub: user.id }, { expiresIn: `${SESSION_HOURS}h` });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_HOURS * 3600 * 1000,
      path: '/',
    });
    return { id: user.id, name: user.name, role: user.role };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    const [hub, merchant] = await Promise.all([
      user.hubId ? this.prisma.hub.findUnique({ where: { id: user.hubId } }) : null,
      user.merchantId ? this.prisma.merchant.findUnique({ where: { id: user.merchantId } }) : null,
    ]);
    return {
      ...user,
      hub: hub && { id: hub.id, code: hub.code, name: hub.name },
      merchant: merchant && { id: merchant.id, code: merchant.code, name: merchant.name },
    };
  }
}
