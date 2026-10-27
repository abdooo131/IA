import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { User } from '@shiplynow/db';
import {
  ACCESS_TOKEN_COOKIE,
  type AccessTokenClaims,
  type LoginInput,
  loginSchema,
  REFRESH_TOKEN_COOKIE,
} from '@shiplynow/shared';
import type { CookieOptions, Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Env } from '../config/env';
import { AuthService, type IssuedTokens, toPublicUser } from './auth.service';
import { clientAddress, LoginThrottleService } from './login-throttle.service';
import { CurrentUser, Public } from './decorators';
import { AuthResponseDto, LoginBody, MeResponseDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly throttle: LoginThrottleService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiBody({ type: LoginBody })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'invalid_credentials' })
  @ApiTooManyRequestsResponse({ description: 'too_many_attempts, with retryAfterSeconds' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const address = clientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress);
    this.throttle.check(body.email, address);
    try {
      const { user, tokens } = await this.auth.login(body);
      this.throttle.succeeded(body.email);
      return this.respond(res, user, tokens);
    } catch (error) {
      if (error instanceof UnauthorizedException) this.throttle.failed(body.email, address);
      throw error;
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'invalid_refresh_token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const presented = readCookie(req, REFRESH_TOKEN_COOKIE);
    try {
      const { user, tokens } = await this.auth.refresh(presented ?? '');
      return this.respond(res, user, tokens);
    } catch (error) {
      this.clearCookies(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, REFRESH_TOKEN_COOKIE));
    this.clearCookies(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiCookieAuth(ACCESS_TOKEN_COOKIE)
  @ApiOkResponse({ type: MeResponseDto })
  async me(@CurrentUser() claims: AccessTokenClaims): Promise<MeResponseDto> {
    return { user: toPublicUser(await this.auth.findActiveUser(claims.sub)) };
  }

  private respond(res: Response, user: User, tokens: IssuedTokens): AuthResponseDto {
    const base = this.cookieBase();
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...base,
      maxAge: tokens.accessTokenExpiresIn * 1000,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...base,
      expires: tokens.refreshTokenExpiresAt,
    });
    return {
      user: toPublicUser(user),
      accessToken: tokens.accessToken,
      expiresIn: tokens.accessTokenExpiresIn,
    };
  }

  private clearCookies(res: Response) {
    const base = this.cookieBase();
    res.clearCookie(ACCESS_TOKEN_COOKIE, base);
    res.clearCookie(REFRESH_TOKEN_COOKIE, base);
  }

  private cookieBase(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      path: '/',
    };
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const value: unknown = req.cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
