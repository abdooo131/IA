import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminSiteLeadsController, SiteController } from './site.controller';

/** The public website: contact form leads and their admin list. */
@Module({
  imports: [AuthModule],
  controllers: [SiteController, AdminSiteLeadsController],
})
export class SiteModule {}
