import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { OrderIntakeService } from './order-intake.service';

@Module({
  imports: [CoverageModule],
  providers: [OrderIntakeService],
  exports: [OrderIntakeService],
})
export class OrdersModule {}
