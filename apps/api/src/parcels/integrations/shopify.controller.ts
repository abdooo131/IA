import { ParseIdPipe } from '../common/id.pipe';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
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

  /** Shopify's "Ship with Shiply" action on the orders the merchant ticked. */
  @Get('ship')
  async picked(@Query() q: Record<string, string | string[]>, @Res() res: Response) {
    res.redirect(302, await this.shopify.pickedInShopify(q));
  }

  @Get('ship/orders')
  shipView(@Query() q: unknown) {
    return this.shopify.shipView(q);
  }

  @Post('ship/create')
  @HttpCode(200)
  shipCreate(@Body() body: unknown) {
    return this.shopify.shipCreate(body);
  }

  @Post('webhooks')
  @HttpCode(200)
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
  ) {
    // The app reads this path's body as raw bytes (setup-app.ts): the signature covers them exactly.
    const raw = Buffer.isBuffer(body) ? body : req.rawBody;
    let parsed: unknown = body;
    if (Buffer.isBuffer(body)) {
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        parsed = {};
      }
    }
    return this.shopify.webhook(raw, headers, parsed);
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

  @Post('sync')
  @HttpCode(200)
  sync(@CurrentUser() u: SessionUser) {
    return this.shopify.sync(u);
  }

  @Post('orders/create')
  @HttpCode(200)
  createPicked(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.shopify.createPicked(u, body);
  }

  @Post('orders/:id/create')
  @HttpCode(200)
  create(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.shopify.createFromOrder(u, id, body);
  }

  @Post('orders/:id/skip')
  @HttpCode(200)
  skip(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.shopify.skip(u, id);
  }
}
