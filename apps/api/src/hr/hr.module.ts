import { Module } from '@nestjs/common';
import { HrController, MyEmployeeController } from './hr.controller';

@Module({ controllers: [HrController, MyEmployeeController] })
export class HrModule {}
