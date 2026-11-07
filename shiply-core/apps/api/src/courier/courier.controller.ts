import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles, type SessionUser } from '../auth/auth';
import { CourierService } from './courier.service';

@Controller('courier')
@Roles('COURIER')
export class CourierController {
  constructor(private readonly courier: CourierService) {}

  @Get('pickups')
  pickups(@CurrentUser() u: SessionUser) {
    return this.courier.pickups(u);
  }

  @Post('pickups/:id/collect')
  @HttpCode(200)
  collect(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.courier.collect(u, id, body);
  }

  @Post('pickups/:id/finish')
  @HttpCode(200)
  finish(@CurrentUser() u: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.courier.finishPickup(u, id);
  }

  @Get('run')
  run(@CurrentUser() u: SessionUser) {
    return this.courier.currentRun(u);
  }

  @Post('stops/:itemId/deliver')
  @HttpCode(200)
  deliver(@CurrentUser() u: SessionUser, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown) {
    return this.courier.deliver(u, itemId, body);
  }

  @Post('stops/:itemId/fail')
  @HttpCode(200)
  fail(@CurrentUser() u: SessionUser, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() body: unknown) {
    return this.courier.fail(u, itemId, body);
  }
}
