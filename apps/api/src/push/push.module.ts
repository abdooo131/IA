import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { HttpPush, PushSender } from './push-sender';
import { PushService } from './push.service';

@Module({
  controllers: [PushController],
  providers: [PushService, { provide: PushSender, useClass: HttpPush }],
  exports: [PushService],
})
export class PushModule {}
