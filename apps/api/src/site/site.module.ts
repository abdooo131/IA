import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteController } from './site.controller';

/** The public website: contact form leads (followed up in the Sales CRM). */
@Module({
  imports: [AuthModule],
  controllers: [SiteController],
})
export class SiteModule {}
