import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { AttendanceController, MyAttendanceController } from './attendance.controller';
import { HrController } from './hr.controller';
import { HrFlowsController } from './hr-flows.controller';
import { HrOrgController } from './hr-org.controller';
import { HrLeaveController } from './hr-leave.controller';
import { MyLeaveController } from './my-leave.controller';
import { MyPayController } from './my-pay.controller';
import { MyEmployeeController, PeoplePhotoController } from './my-hr.controller';

@Module({
  imports: [CoverageModule],
  controllers: [
    HrController,
    HrFlowsController,
    HrOrgController,
    MyEmployeeController,
    PeoplePhotoController,
    AttendanceController,
    MyAttendanceController,
    HrLeaveController,
    MyLeaveController,
    MyPayController,
  ],
})
export class HrModule {}
