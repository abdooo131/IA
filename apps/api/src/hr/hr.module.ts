import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { AttendanceController, MyAttendanceController } from './attendance.controller';
import { HrController } from './hr.controller';
import { HrOrgController } from './hr-org.controller';
import { MyEmployeeController, PeoplePhotoController } from './my-hr.controller';

@Module({
  imports: [CoverageModule],
  controllers: [
    HrController,
    HrOrgController,
    MyEmployeeController,
    PeoplePhotoController,
    AttendanceController,
    MyAttendanceController,
  ],
})
export class HrModule {}
