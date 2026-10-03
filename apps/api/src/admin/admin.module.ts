import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AdminController } from './admin.controller';

@Module({ imports: [AppConfigModule], controllers: [AdminController] })
export class AdminModule {}
