import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, Public, Roles, type SessionUser } from '../auth/auth';
import { ShopifyService } from './shopify.service';

/** Shopify calls these: the install redirect and the order webhooks. Both are checked by signature. */
@Controller('integrations/shopify')
@Public()
export class ShopifyPublicController {
  constructor(private readonly shopify: ShopifyService) {}

  @Get('callback')
  async callback(@Query() q: Record<string, string>, @Res() res: Response) {
    res.redirect(302, await this.shopify.callback(q));
  }

  @Post('webhooks')
  @HttpCode(200)
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>, @Body() body: unknown) {
    return this.shopify.webhook(req.rawBody, headers, body);
  }
}

@Controller('merchant/shopify')
@Roles('MERCHANT')
export class ShopifyMerchantController {
  constructor(private readonly shopify: ShopifyService) {}

  @Get()
  view(@CurrentUser() u: SessionUser) {
    return this.shopify.view(u);
  }

  @Post('install')
  @HttpCode(200)
  install(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.shopify.installUrl(u, body);
  }

  @Put('settings')
  settings(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.shopify.saveSettings(u, body);
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentUser() u: SessionUser) {
    return this.shopify.disconnect(u);
  }

  @Post('orders/:id/create')
  @HttpCode(200)
  create(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.shopify.createFromOrder(u, id, body);
  }

  @Post('orders/:id/skip')
  @HttpCode(200)
  skip(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shopify.skip(u, id);
  }
}
