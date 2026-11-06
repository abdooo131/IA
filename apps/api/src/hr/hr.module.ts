import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { AttendanceController, MyAttendanceController } from './attendance.controller';
import { HrController, MyEmployeeController } from './hr.controller';

@Module({
  imports: [CoverageModule],
  controllers: [HrController, MyEmployeeController, AttendanceController, MyAttendanceController],
})
export class HrModule {}
