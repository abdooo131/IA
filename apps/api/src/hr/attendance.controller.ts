import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  addManualPunch,
  attendanceBoard,
  attendanceDayDetail,
  clockPunch,
  createHoliday,
  createShift,
  deleteHoliday,
  DomainError,
  generateRoster,
  getRoster,
  listAttendanceDays,
  listHolidays,
  listShifts,
  myAttendance,
  setDayStatus,
  setDefaultShift,
  setRosterCell,
  updateShift,
  voidPunch,
  weekStart,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  addDays,
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  cairoDay,
  type ClockBody,
  clockSchema,
  type DayStatusBody,
  dayStatusSchema,
  defaultShiftSchema,
  type HolidayBody,
  holidaySchema,
  isCalendarDay,
  type ManualPunchBody,
  manualPunchSchema,
  type RosterCellBody,
  rosterCellSchema,
  type ShiftBody,
  shiftSchema,
  voidPunchSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { limitedStores } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cairoStamp, csv } from '../finance/finance-csv';
import { PrismaService } from '../prisma/prisma.service';

const generateSchema = z.object({
  week: z.string().optional(),
  darkStoreId: z.string().max(64).nullable().optional(),
});

const day = (value: string | undefined, fallback: string) => {
  if (!value) return fallback;
  if (!isCalendarDay(value)) throw new DomainError('invalid_date', 400);
  return value;
};
const hm = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Attendance (docs/HR.md 2). Shifts and holidays are HR manage to change; the Today board,
 * attendance days and the roster are HR view to read and HR use to change (roster cells,
 * default shifts, manual punches, voiding a punch, a day's status). People limited to some
 * stores see and change only those stores' people; office people need every store.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Access('hr')
@Controller('hr')
export class AttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get('shifts')
  shifts() {
    return listShifts(this.prisma);
  }

  @Post('shifts')
  @Access('hr', 'manage')
  createShift(
    @Body(new ZodValidationPipe(shiftSchema)) body: ShiftBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createShift(this.prisma, { body, actorUserId: user.sub, now: this.clock.now() });
  }

  @Put('shifts/:id')
  @Access('hr', 'manage')
  updateShift(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shiftSchema)) body: ShiftBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return updateShift(this.prisma, {
      shiftId: id,
      body,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  @Get('holidays')
  @ApiQuery({ name: 'year', required: false })
  holidays(@Query('year') year?: string) {
    const y = year && /^\d{4}$/.test(year) ? Number(year) : undefined;
    return listHolidays(this.prisma, y);
  }

  @Post('holidays')
  @Access('hr', 'manage')
  createHoliday(
    @Body(new ZodValidationPipe(holidaySchema)) body: HolidayBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return createHoliday(this.prisma, { body, actorUserId: user.sub, now: this.clock.now() });
  }

  @Delete('holidays/:id')
  @Access('hr', 'manage')
  deleteHoliday(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return deleteHoliday(this.prisma, {
      holidayId: id,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  /** One week (Saturday to Friday) of a store's roster; no darkStoreId: the office. */
  @Get('roster')
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'week', required: false })
  roster(
    @CurrentAccess() access: AccessProfile,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('week') week?: string,
  ) {
    return getRoster(this.prisma, {
      storeId: darkStoreId || null,
      week: day(week, cairoDay(this.clock.now())),
      scope: limitedStores(access),
    });
  }

  @Put('roster')
  setCell(
    @Body(new ZodValidationPipe(rosterCellSchema)) body: RosterCellBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return setRosterCell(this.prisma, {
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  /** Fills the week's empty days from each person's default shift (planned days are kept). */
  @Post('roster/generate')
  async generate(
    @Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const scope = limitedStores(access);
    const storeId = body.darkStoreId || null;
    if (scope && (!storeId || !scope.includes(storeId)))
      throw new DomainError('store_not_allowed', 403);
    const from = weekStart(day(body.week, cairoDay(this.clock.now())));
    const people = await this.prisma.employee.findMany({
      where: { homeStoreId: storeId },
      select: { id: true },
    });
    return generateRoster(this.prisma, {
      from,
      days: 7,
      employeeIds: people.map((p) => p.id),
      actorUserId: user.sub,
    });
  }

  @Patch('employees/:id/default-shift')
  defaultShift(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(defaultShiftSchema)) body: { shiftId: string | null },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return setDefaultShift(this.prisma, {
      employeeId: id,
      shiftId: body.shiftId,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  /** Who is in, late, missing, off or on leave right now. */
  @Get('attendance/today')
  @ApiQuery({ name: 'darkStoreId', required: false })
  today(@CurrentAccess() access: AccessProfile, @Query('darkStoreId') darkStoreId?: string) {
    return attendanceBoard(this.prisma, {
      scope: limitedStores(access),
      storeId: darkStoreId || null,
      now: this.clock.now(),
    });
  }

  private days(
    access: AccessProfile,
    q: { from?: string; to?: string; darkStoreId?: string; employeeId?: string; status?: string },
  ) {
    const today = cairoDay(this.clock.now());
    const to = day(q.to, today);
    const from = day(q.from, addDays(to, -6));
    if (from > to) throw new DomainError('invalid_range', 400);
    if (addDays(from, 92) < to) throw new DomainError('range_too_long', 400);
    return listAttendanceDays(this.prisma, {
      scope: limitedStores(access),
      storeId: q.darkStoreId || undefined,
      employeeId: q.employeeId || undefined,
      status: ATTENDANCE_STATUSES.includes(q.status as AttendanceStatus)
        ? (q.status as AttendanceStatus)
        : undefined,
      from,
      to,
    });
  }

  /** Closed attendance days (Cairo days, at most about three months at a time). */
  @Get('attendance/days')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ATTENDANCE_STATUSES })
  list(
    @CurrentAccess() access: AccessProfile,
    @Query()
    q: { from?: string; to?: string; darkStoreId?: string; employeeId?: string; status?: string },
  ) {
    return this.days(access, q);
  }

  /** The same list as a CSV file for Excel. */
  @Get('attendance/days.csv')
  async exportCsv(
    @Res() res: Response,
    @CurrentAccess() access: AccessProfile,
    @Query()
    q: { from?: string; to?: string; darkStoreId?: string; employeeId?: string; status?: string },
  ) {
    const rows = await this.days(access, q);
    const time = (v: Date | null) => (v ? cairoStamp(v).slice(11) : '');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="shiply-attendance.csv"');
    res.send(
      csv(
        [
          'day',
          'employee_code',
          'name_en',
          'name_ar',
          'store',
          'status',
          'shift_start',
          'shift_end',
          'first_in',
          'last_out',
          'late_minutes',
          'early_minutes',
          'overtime_minutes',
          'worked_hours',
          'flags',
          'correction_reason',
        ],
        rows.map((r) => [
          r.day,
          r.employee.code,
          r.employee.nameEn,
          r.employee.nameAr,
          r.store?.code ?? 'office',
          r.status,
          time(r.plannedStart),
          time(r.plannedEnd),
          time(r.firstIn),
          time(r.lastOut),
          r.lateMinutes,
          r.earlyMinutes,
          r.overtimeMinutes,
          hm(r.workedMinutes),
          r.flags.join(' '),
          r.correctionReason,
        ]),
      ),
    );
  }

  /** One person's day: the plan, its punches (voided ones too) and the closed row. */
  @Get('attendance/day')
  @ApiQuery({ name: 'employeeId' })
  @ApiQuery({ name: 'day' })
  detail(
    @CurrentAccess() access: AccessProfile,
    @Query('employeeId') employeeId: string,
    @Query('day') d: string,
  ) {
    if (!employeeId) throw new DomainError('validation_failed', 400);
    return attendanceDayDetail(this.prisma, {
      employeeId,
      day: day(d, ''),
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Post('attendance/punches')
  manualPunch(
    @Body(new ZodValidationPipe(manualPunchSchema)) body: ManualPunchBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return addManualPunch(this.prisma, {
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Post('attendance/punches/:id/void')
  void(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidPunchSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return voidPunch(this.prisma, {
      punchId: id,
      reason: body.reason,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }

  @Post('attendance/days/status')
  status(
    @Body(new ZodValidationPipe(dayStatusSchema)) body: DayStatusBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return setDayStatus(this.prisma, {
      body,
      actorUserId: user.sub,
      scope: limitedStores(access),
      now: this.clock.now(),
    });
  }
}

/**
 * My attendance: every team member and rider clocks in and out from their phone and reads
 * their own days. Open to any signed in user (listed in test/route-access.test.ts); merchants
 * have no employee file and get 404.
 */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('me')
export class MyAttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get('attendance')
  @ApiQuery({ name: 'month', required: false })
  mine(@CurrentUser() user: AccessTokenClaims, @Query('month') month?: string) {
    return myAttendance(this.prisma, {
      userId: user.sub,
      now: this.clock.now(),
      month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    });
  }

  @Post('attendance/clock-in')
  async clockIn(
    @Body(new ZodValidationPipe(clockSchema.partial())) body: Partial<ClockBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.punch(user.sub, 'in', body);
  }

  @Post('attendance/clock-out')
  async clockOut(
    @Body(new ZodValidationPipe(clockSchema.partial())) body: Partial<ClockBody>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.punch(user.sub, 'out', body);
  }

  private async punch(userId: string, kind: 'in' | 'out', body: Partial<ClockBody>) {
    const now = this.clock.now();
    const punch = await clockPunch(this.prisma, { userId, kind, position: body, now });
    const mine = await myAttendance(this.prisma, { userId, now });
    return { punch, today: mine.today };
  }
}
