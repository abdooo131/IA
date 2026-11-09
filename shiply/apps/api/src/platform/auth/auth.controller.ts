import { Body, Controller, HttpCode, HttpException, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../validate';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

const LoginBody = z.object({ login: z.string().min(1).max(200), password: z.string().min(1).max(200) });

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  private async setCookies(res: Response, userId: string) {
    const t = await this.auth.tokens(userId);
    const base = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
    res.cookie('sid', t.sid, { ...base, maxAge: t.sessionMs });
    res.cookie('rid', t.rid, { ...base, maxAge: t.refreshMs });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { login, password } = parse(LoginBody, body);
    const userId = await this.auth.login(login, password);
    await this.setCookies(res, userId);
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = this.auth.read(req.cookies?.rid, 'refresh');
    if (!userId || !(await this.auth.sessionUser(userId))) throw new HttpException({ error: 'signed_out' }, 401);
    await this.setCookies(res, userId);
    return { ok: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('sid', { path: '/' });
    res.clearCookie('rid', { path: '/' });
    return { ok: true };
  }
}
