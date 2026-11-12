import { Module } from '@nestjs/common';
import {
  EmailsController,
  MerchantEmailSettingsController,
  OwnEmailSettingsController,
} from './emails.controller';
import { EmailService } from './email.service';
import { Mailer, SmtpMailer } from './mailer';

@Module({
  controllers: [EmailsController, MerchantEmailSettingsController, OwnEmailSettingsController],
  providers: [EmailService, { provide: Mailer, useClass: SmtpMailer }],
  exports: [EmailService],
})
export class EmailModule {}
