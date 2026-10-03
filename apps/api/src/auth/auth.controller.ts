import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { APPS, RequestContext } from '../common/context';
import { Ctx, Public } from '../common/decorators';
import { parse } from '../common/zod';
import { AuthService } from './auth.service';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  app: z.enum(APPS),
});
const RefreshSchema = z.object({ refreshToken: z.string().min(10) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    const b = parse(LoginSchema, body);
    return this.auth.login(b.email, b.password, b.app, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parse(RefreshSchema, body).refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parse(RefreshSchema, body).refreshToken);
  }

  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx.userId!);
  }

  @Patch('me/language')
  language(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.auth.setLanguage(ctx, parse(z.object({ language: z.enum(['en', 'ar']) }), body).language);
  }
}
