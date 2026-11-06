# HR module (plan approved; steps 1 and 2 built)

Decisions taken by the owner on 2026-11-06: attendance by a Clock in button with a location
check, violations from a penalty list that reaches payroll, leave by requests and balances,
account managers own merchants, QC agents check packing and received shipments.

## 1. Every employee has a file and an account

- `employees`: one per person who works for us (employee or outsourced), linked to their
  user account (every employee gets one; riders and store staff already have one).
- File: full name in Arabic and English, national ID and its expiry, birth date, address,
  mobile, emergency contact, job title, department, manager, store, hire date, contract
  type and end date, probation end, employment (employee or outsourced through a supplier),
  social insurance number, bank account for salary, status (active, on leave, suspended,
  left with the date and reason).
- Documents (photos or PDFs stored like proof photos): ID copy, contract, criminal record
  certificate, military status, qualification, medical certificate; each with an expiry
  date where it has one, and an alert 30 days before it runs out.
- History: one timeline per employee of everything (hired, job or salary change, transfers
  between stores, attendance problems, leave, violations and penalties, QC results,
  warnings, left), built from the records below and the audit log.
- Job roles added: Account manager, QC agent, HR officer (HR app manage).
- Access: a new **HR** app in the access table; employee files are HR use; salaries stay
  behind the salaries switch; every person sees their own file, attendance, leave balance
  and violations (read only) under My HR.

## 2. Attendance

- Shifts: shift templates (start, end, break, days) and a weekly roster per store or team;
  grace minutes and overtime rules are settings.
- Clock in and Clock out buttons in every app (store, rider, office). For store, hub and
  rider staff the phone location must be within `hr.clock_radius_m` of their store
  (default 150 m); office staff of the office address. The location and the device are
  saved with each punch. Without a location the punch is refused (the manager can add a
  manual punch with a reason, audited).
- Each day becomes an attendance day: present, late (minutes), left early, absent, on
  leave, day off, holiday (official holidays list in settings), overtime minutes.
- Managers see today's board per store (who is in, late, missing) and fix days with a
  reason; a forgotten clock out closes at the shift end and is flagged.
- Riders cannot take orders while clocked out (optional setting).

## 3. Leave

- Types with yearly balances from settings, Egyptian law defaults that HR confirms: annual
  (21 days, 30 after 10 years or age 50), casual (6 days inside the annual), sick (with a
  doctor's note photo), unpaid, plus any type HR adds.
- Employees request from the app; their manager approves or refuses; HR can override.
  Approved leave fills the attendance days; balances update; unpaid leave reaches payroll.

## 4. Violations and penalties

- A penalty list in settings (the company's penalty rules): each violation (late arrival,
  absence without leave, leaving early, cash shortage, damaged goods, rudeness, QC fail...)
  with escalating penalties for the 1st, 2nd, 3rd time inside a period: warning, deduction
  of hours or days of pay, suspension.
- Attendance problems raise violations automatically (late beyond the grace, absence);
  others are recorded by the manager or QC. Every violation is shown to the employee, who
  may write a reply; the manager confirms or cancels; only confirmed deductions reach the
  monthly payroll run as a deduction line.
- Limits from the law (for example no more than 5 days deducted per month for one
  violation) are settings for HR to confirm.

## 5. Account managers

- Each merchant has one account manager. An account manager sees only their merchants in
  the Merchants app, orders, stock, wallets and tickets of those merchants, and receives
  their merchant alerts (signups, low stock, debit wallet, Shopify problems).

## 6. QC agents

- QC checklists in settings (packing: right items, seal, photo, label; receiving: counts,
  damage, labels).
- A sample of packed orders and received shipments (rate in settings, plus any order a
  QC agent picks) waits in a QC queue; the agent checks with photos and the checklist and
  marks pass or fail with notes.
- A fail can raise a violation for the staff member who packed or received it, and results
  give each store and person a quality score shown on their file and the store board.

## 7. Payroll link

- The monthly payroll run takes confirmed penalty deductions, unpaid leave and overtime
  (rates in settings) from HR, so payslips show them; nothing is deducted without a
  confirmed record.

## Step 1 as built (decisions taken while building)

- `employees` is one row per team member and rider, 1:1 with `users` (EMP-0001 numbers). The
  display name, sign in mobile (`users.phone`, edited from the file), employment and staffing
  supplier stay on `users`; the file keeps the full names in English and Arabic. Store staff and
  riders work at their account's store (`users.dark_store_id`, changed in Users, copied to the
  file); office people have the store on the file (empty means the office).
- The national ID and the social insurance number moved from `staff_salaries` to the file; the
  Payroll screen and the salary tax and insurance lists read and write them there.
- Contract type: permanent, fixed term (needs its end date) or part time; outsourced follows
  the employment set in Payroll and cannot be chosen in HR. Probation end is filled in from the
  hire date with `hr.probation_months` (default 3) when HR leaves it empty.
- A new account in Users opens the file at once; HR manage can open a file for an older account
  without one (HR never creates accounts, because access is settings manage's job). The seed and
  the demo give every person a file.
- Status: active, on leave, suspended, left. Left needs the last day and a reason, and also
  disables the account and signs the person out (the last person with settings manage cannot be
  marked as left). Coming back does not reopen the account; Users does.
- HR access: view reads files, use edits them and adds documents, manage opens files, changes
  the status and deletes documents. The salary and the salary bank account need the salaries
  switch too. People limited to listed stores see only the files of those stores.
- Documents are kept in `employee_documents` (bytea, photo or PDF up to 3 MB, checked by their
  first bytes), not in `photos`, so only HR and the person can open them. The phone shrinks
  photos before upload.
- Alerts: the API job checks once an hour and raises one `document_expiring` alert
  `hr.document_alert_days` (default 30) before a document or the national ID date runs out and
  one `document_expired` on the day; each has its own key (`alerts.key`), so repeats change
  nothing and a renewed document with a new date is watched again. HR sees them on the
  Employees page; the Operations alerts list hides them from people without HR access.
- History: one timeline from the audit log of the file (changes, status, documents) and of the
  account (created, changed, access); pay changes and bank details only with salaries.
- My HR (`/my-file`, in the Settings menu of every team member and rider): the person's own file,
  documents and history, read only, including their own bank details.
- Account managers (section 5, built with step 1): see docs/ACCESS.md. Tickets of their
  merchants and the other merchant alerts (low stock, debit wallet, Shopify problems) reach them
  once those alerts carry the merchant (the Shopify ones were left for the agent working there).

## Step 2 as built (decisions taken while building)

- Data: `shifts` (name in English and Arabic, start and end as Cairo minutes, break minutes,
  working weekdays, overnight allowed, in use), `employees.default_shift_id`, `roster_days`
  (one per person and Cairo day: a shift with its times copied, or a day off; `edited` when
  changed by hand), `holidays`, `punches` (in or out, the instant, latitude, longitude,
  accuracy and distance in metres, the store checked, device, source app, manual or auto,
  reason, by; never deleted: a database trigger refuses it, a wrong punch is voided with a
  reason) and `attendance_days` (status, computed status, the manager's status, planned start
  and end, first in, last out, late, early, overtime and worked minutes, flags, who corrected
  it and why).
- Settings: `hr.clock_radius_m` (150, per store), `hr.max_accuracy_m` (100),
  `hr.late_grace_minutes` (10), `hr.overtime_after_minutes` (30), `hr.auto_close_hours` (4),
  `hr.riders_must_clock_in` (0, per store), `hr.office_lat` and `hr.office_lng` (0: not set;
  the only settings that take decimals).
- Where a person clocks in: their store on the file (store staff and riders: their account's
  store, so hub staff and QC agents use the hub or store they are linked to); a file without a
  store is office staff, checked against the office settings. Refusals answer
  `no_position` (400), `position_inaccurate` (400, with `accuracyM` and `maxAccuracyM`),
  `too_far` (403, with `distanceM` and `radiusM`), `office_location_not_set` (409),
  `already_clocked_in` and `not_clocked_in` (409), `employee_not_active` (403, suspended or
  left). The distance must be within the radius; the accuracy is not added to it.
- The roster week runs Saturday to Friday. The API's job (every 10 minutes) plans the coming
  two weeks from each default shift (days already planned are kept) and closes every day of
  the last 7 that is over: a day closes `hr.auto_close_hours` after its shift end (and never
  before the Cairo day ends). Changing a person's default shift or a shift template plans
  their coming generated days again from tomorrow; edited days stay.
- A session (in, then out) belongs to the Cairo day of its clock in, or to the day before when
  that day's overnight shift has not ended yet. A second in while one is open and an out
  without an in are ignored.
- Statuses: on leave (the file's status is on leave; leave requests come in step 3), holiday
  (official holiday; work on it is overtime), day off (planned off; work on it is overtime),
  absent (planned, no punch), late (first in more than the grace after the start), left early
  (last out more than the grace before the end), else present. A person who worked without
  any roster is present. Late minutes are the raw minutes after the start (the status uses the
  grace); overtime is the time past the shift end once it reaches `hr.overtime_after_minutes`;
  worked minutes are the sessions minus the shift's break.
- Forgot clock out: when the day closes and the person is still in, an `auto` out punch is
  added at the shift end (at the clock in when there was no shift, so nothing is paid by
  guess) and the day is flagged `forgot_clock_out`. Clocking in the next morning closes the
  open day first, so nobody is stuck as already clocked in.
- Corrections (HR use): a manual punch with a reason, voiding a punch with a reason, or the
  day's status with a reason (null goes back to the computed one). A closed day is built again
  after each change; the manager's status stays through later rebuilds. Every change is in
  the person's history (audit on the employee). Adding or removing a holiday rebuilds closed
  days of that date.
- Riders: with `hr.riders_must_clock_in` at 1 (per store), handing an order to a rider who is
  not clocked in answers `rider_not_clocked_in`. Off by default.
- Access: shifts and holidays are HR manage to change; the Today board, attendance days, the
  roster and day details are HR view; roster cells, default shifts and corrections are HR use.
  People limited to listed stores see and change only those stores' people; office people need
  every store. Store managers got HR view (their stores' board, roster and days, and the files
  of their people); fixing days stays with HR (use). Everyone's own: `GET /me/attendance`,
  `POST /me/attendance/clock-in` and `clock-out` (merchants get 404).
- Screens: the Clock in card on the store home, the rider home and My HR (with the month's
  days); HR app menus Attendance (Today, Attendance days with CSV, Roster) and Configuration
  (Shifts, Official holidays, HR settings). A day opens from the board or the list for
  corrections.
- Seed: shifts Morning 10:00 to 16:00 (Friday off) and Evening 16:00 to 22:00 (Thursday off)
  are created when there is no shift; store staff and riders without a default shift get them
  alternately within their store (never someone whose shift HR set or cleared), with two weeks
  planned. The demo month plans from its first day and simulates punches at each store (most
  on time, some late, a few absent or forgetting to clock out), then closes the days.

## Build order

1. Employee files, documents, HR app and access, history (about 2 sessions). Built, with
   account managers (part of 5).
2. Shifts, Clock in with location, attendance days and the manager board (2 sessions). Built.
3. Leave requests and balances (1 session).
4. Penalty list, violations, payroll link (1 to 2 sessions).
5. Account managers (1 session) and QC queue and scores (1 to 2 sessions).

Each step is tested, committed and put online on its own.
