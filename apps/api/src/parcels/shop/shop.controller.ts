import { ParseIdPipe } from '../common/id.pipe';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Roles, type SessionUser } from '../auth/auth';
import { ShopService } from './shop.service';

function sendFile(res: Response, f: { data: Uint8Array; mime: string; name: string }) {
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(f.data));
}

/** Products, stock and purchase orders: the office. Packaging orders: the office and the facility floor. */
@Controller('shop')
@Roles('ADMIN')
export class ShopAdminController {
  constructor(private readonly shop: ShopService) {}

  @Get('products')
  products() {
    return this.shop.products();
  }

  @Post('products')
  create(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.shop.saveProduct(null, body, u);
  }

  @Put('products/:id')
  update(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.shop.saveProduct(id, body, u);
  }

  @Post('products/:id/adjust')
  @HttpCode(200)
  adjust(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.shop.adjust(id, body, u);
  }

  @Get('products/:id/moves')
  moves(@Param('id', ParseIdPipe) id: string) {
    return this.shop.moves(id);
  }

  /** Accounting's suppliers, to buy from (they are opened in Accounting). */
  @Get('suppliers')
  suppliers() {
    return this.shop.suppliers();
  }

  @Get('purchase-orders')
  pos() {
    return this.shop.purchaseOrders();
  }

  @Post('purchase-orders')
  createPo(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.shop.savePo(null, body, u);
  }

  @Put('purchase-orders/:id')
  updatePo(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.shop.savePo(id, body, u);
  }

  @Post('purchase-orders/:id/order')
  @HttpCode(200)
  orderPo(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.shop.orderPo(id, u);
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(200)
  cancelPo(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.shop.cancelPo(id, u);
  }

  @Post('purchase-orders/:id/receive')
  @HttpCode(200)
  receive(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.shop.receive(id, body, u);
  }

  @Get('orders')
  @Roles('ADMIN', 'HUB_STAFF')
  orders(@CurrentUser() u: SessionUser, @Query('status') status?: string) {
    return this.shop.orders(
      status || undefined,
      u.role === 'ADMIN' ? undefined : (u.hubId ?? '00000000-0000-0000-0000-000000000000'),
    );
  }

  @Post('orders/:id/pack')
  @Roles('ADMIN', 'HUB_STAFF')
  @HttpCode(200)
  async pack(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    await this.shop.assertOrderHub(id, u);
    return this.shop.pack(id, u);
  }

  @Post('orders/:id/out')
  @Roles('ADMIN', 'HUB_STAFF')
  @HttpCode(200)
  async out(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    await this.shop.assertOrderHub(id, u);
    return this.shop.sendOut(id, body, u);
  }

  @Post('orders/:id/cancel')
  @Roles('ADMIN', 'HUB_STAFF')
  @HttpCode(200)
  async cancel(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    await this.shop.assertOrderHub(id, u);
    return this.shop.cancel(id, body, u);
  }
}

@Controller()
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('shop/products/:id/photo')
  @Roles('ADMIN', 'HUB_STAFF', 'MERCHANT')
  async photo(@Param('id', ParseIdPipe) id: string, @Res() res: Response) {
    sendFile(res, await this.shop.photo(id));
  }

  @Get('merchant/shop')
  @Roles('MERCHANT')
  catalog(@CurrentUser() u: SessionUser) {
    return this.shop.catalog(u);
  }

  @Get('merchant/shop/orders')
  @Roles('MERCHANT')
  myOrders(@CurrentUser() u: SessionUser) {
    return this.shop.merchantOrders(u);
  }

  @Post('merchant/shop/orders')
  @Roles('MERCHANT')
  place(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.shop.placeOrder(u, body);
  }

  @Post('merchant/shop/orders/:id/cancel')
  @Roles('MERCHANT')
  @HttpCode(200)
  merchantCancel(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.shop.merchantCancel(u, id);
  }

  @Get('courier/packaging')
  @Roles('COURIER')
  courierOrders(@CurrentUser() u: SessionUser) {
    return this.shop.courierOrders(u);
  }

  @Post('courier/packaging/:id/deliver')
  @Roles('COURIER')
  @HttpCode(200)
  deliver(
    @CurrentUser() u: SessionUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.shop.deliver(u, id, body);
  }

  @Post('courier/packaging/:id/send-code')
  @Roles('COURIER')
  @HttpCode(200)
  resend(@CurrentUser() u: SessionUser, @Param('id', ParseIdPipe) id: string) {
    return this.shop.courierResend(u, id);
  }
}
