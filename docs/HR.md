# HR module (plan approved; step 1 built, then HR v2; step 2 built; phase 3 built; phase 1 usability built)

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

## HR v2 as built (decisions taken while building)

The owner's review of step 1: "HR has nothing to do with accounting. Where is the team
distribution and the type: senior, junior, head, manager... to automatically make a tree?
Documents need more development, and employees need an image." HR v2 answers it.

### HR owns people, Accounting only pays

- Employment (employee on our payroll, or outsourced through a staffing company, a supplier)
  moved from `users` to the file: `employees.employment` and `employees.staffing_supplier_id`
  (a database check keeps an outsourced person tied to their company). The contract type
  follows it (outsourced, or back to permanent). HR sets it: `PUT /hr/employees/:id/employment`
  (HR use).
- The salary package replaces `staff_salaries` (dropped; each salary became the person's first
  package): `salary_packages` (from a day, basic, insured wage, note, who) with
  `salary_allowances` (housing, transport, phone, other, an optional label, an amount). The
  gross is basic plus allowances. A package on a day that already has one replaces that day's
  row; any other day adds a row, so the list is the history. When no day is given the first
  package starts on the hire date, later ones today. A package outside the grade's band is
  allowed and flagged (`outsideBand`). HR use with the salaries switch edits
  (`POST /hr/employees/:id/package`); HR view with salaries reads (`GET .../package`).
- The payroll run reads the package in force on the month's last day; before the first package
  was recorded the first one applies (nothing older was ever kept). `listStaffPay` (the Payroll
  screen) shows the package in force today read only, with a link to the HR file for people who
  have HR access. `PUT /finance/salaries/:userId` and `PUT /finance/employment/:userId` are gone;
  the Payroll screen says that HR keeps people and Accounting runs, books and pays. The cash
  flow forecast sums the packages in force. Outsourced bills check the company on the file.
- Pay changes (`employee.package`, and the older `finance.salary_set`) show in a person's
  history only with the salaries switch; employment changes (`employee.employment`) show to HR.

### Organisation: departments, positions, grades, managers

- `departments`: a tree (parent), a head (an employee), an optional cost centre store, order and
  active. Defaults (fixed ids, added by the migration and the seed): Management; under it
  Operations (Dark stores, Hub, Riders, Quality control), Commercial (Account management,
  Sales), Finance, Human resources, Technology, Customer service. A department cannot sit under
  itself (`department_loop`); one with people or active sub departments cannot be closed.
- `grades`: an ordered list (rank, 1 is the most junior) with an optional salary band:
  Intern, Junior, Mid level, Senior, Lead, Supervisor, Manager, Head, Director, Chief (C level).
  HR moves a grade up or down (ranks swap).
- `job_positions`: title in both languages, department, lowest and highest grade, planned
  headcount. The seed adds 18 positions (CEO, Head of operations, Store manager, Picker and
  packer, Hub supervisor and associate, Rider supervisor, Rider, QC agent, Head of commercial,
  Account manager, Sales executive, Finance manager, Accountant, HR manager, HR officer,
  Software engineer, Customer service agent).
- Each file has a department, a position, a grade and optionally a manager. Choosing a position
  fills the department when the file has none; a grade outside the position's range is refused
  (`grade_outside_position`). `job_title` stays as a free title for people without a position.
- The manager in force: the one set on the file, else the head of the person's department, else
  the head of the department above, and so on (a head reports to the head above). Left people
  are out of the tree. After every change to a manager, a department, a position, a department
  head or a parent, the whole graph is checked and a loop is refused (`manager_loop`), through
  department heads too. A person who leaves stops heading departments.
- `GET /hr/org` returns people with their manager in force and its source, the department tree
  with headcount, and open places (planned minus people in a position) attached to the head of
  the position's department. The org chart (`/admin/hr/org`) is plain React and CSS: a tree by
  manager (cards with photo, name, title and grade; groups of people without reports stack in a
  column; levels below the second start folded; search opens the path to each match; zoom;
  logical CSS so it mirrors in Arabic; scrolls sideways on phones), or a department view
  (nested department boxes with head, headcount, people and open places). Export PNG draws the
  cards and connectors on screen into a canvas (no new library); Print uses the browser.
- Team: `teamOf` lists everyone below a person (direct and indirect, with their level) and
  counts by grade and department; it is a tab of the HR file and `/my-file/team` for managers.

### Photo

- `employee_photos` (one row per person, apart from `employees` so lists never load bytes): a
  square JPEG made on the phone (pick or take, drag and zoom inside a circle, 512 px), at most
  1 MB, checked by its first bytes. HR use sets or removes it on the file; everyone sets their
  own from My HR. Lists carry `photoVersion`, and `/api/people/:id/photo?v=` serves it (the
  person, their managers and HR view within their stores). Shown on the file header, the
  directory (table and cards), the org chart, team lists, My HR and the account menu button.

### Documents

- Document types are rows (`employee_document_types`): names, has expiry, required (with lists of
  employments, departments and positions; nothing ticked is everyone, a department covers those
  below it), allowed formats, largest size (at most 3 MB), confidential (only HR use and the
  person see it), self upload (the person may send it), several per person, alert days (else
  `hr.document_alert_days`). The step 1 kinds became types (`doctype_<kind>`); a driving licence
  for Riders was added.
- Versions: uploading a type kept once per person makes a new version of the current one
  (`version`, `previous_id`, `is_current`); types with several documents add separate ones
  unless a version is named. Deleting the current version (HR manage) makes the one before it
  current again.
- Verification: `pending`, `verified`, `rejected` with a note. HR uploads count as verified (HR
  saw the original); uploads from My HR wait for HR. HR use verifies or refuses the current
  version. A type with an expiry needs the date.
- The checklist of a file lists every required type and anything on file: missing, waiting for
  HR, refused, verified, expiring (inside its alert days) or expired. Completeness is the share
  of required types holding a valid verified document; it shows on the directory, the file
  header, the overview and My HR.
- Self service (`POST /me/employee/documents`): a type that allows it and is not confidential,
  when nothing valid is on file (missing, refused, expired or expiring); otherwise
  `document_already_on_file`.
- `/admin/hr/documents`: what waits for verification, and every required document not in order
  across the company (filters by department, type and state) with a CSV export.
- Preview: photos as an image, PDFs in a frame (the web app allows same origin framing only for
  the two document addresses), plus download and open in a new tab.
- Expiry alerts are per current document with its type's alert days; a refused document raises
  none. Alert rows carry the type's names.

### Onboarding and offboarding

- `checklist_templates` (kind, position or the default, tasks with an owner: HR, manager,
  employee, IT, finance, store; due days from the start; an optional document type). The seed
  adds Onboarding, Store staff onboarding, Rider onboarding and Offboarding.
- A new account in Users (or HR opening a file) starts the onboarding checklist from the
  position's template, else the default; marking a person as left starts offboarding from the
  last day. HR can start one by hand. Only one open checklist per kind. The tasks are copied, so
  editing a template never changes a running checklist.
- HR use ticks tasks; a task tied to a document type ticks itself when a verified document of
  that type is on file. The checklist closes with its last task; HR manage may cancel one.
  `/admin/hr/checklists` lists open ones, late first.

### Screens

- HR app menus: Employees (Directory, Org chart), Documents (Documents, Onboarding and
  offboarding), Configuration (Departments, Positions, Grades, Document types, Checklist
  templates, Settings).
- Directory: four numbers (active, away, documents missing, open places), document alerts,
  filters (search by name, mobile as typed, national ID or EMP code; department with those below
  it, position, grade, store, status, employment), table or cards, CSV export.
- File: the profile header (photo, names in both languages, position, grade, department, manager
  with a link, status, tenure, store, documents %) and tabs Overview, Job and contract (employment
  and the form), Salary package (salaries switch), Documents, Onboarding, Team, History.
- My HR (`/my-file`): the same header with the person's own photo editor, what they still have to
  send, their document checklist with uploads, their onboarding, their team (managers), their
  file and history. A manager's team file (`/my-file/team/:id`) shows the header and onboarding
  without pay, ID numbers, address or documents.

### Access (docs/ACCESS.md)

- HR view reads files, the org chart, configuration, documents of types that are not
  confidential and the document lists. HR use edits files, employment, photos, uploads, verifies
  and ticks tasks; confidential types need HR use. HR manage opens files, changes status,
  deletes documents, cancels checklists and changes the structure and templates. Salary
  packages need the salaries switch on top (read with view, change with use).
- New job role HR manager: HR manage with salaries. HR officer stays HR manage without salaries.
  Finance manager keeps accounting manage with salaries and no HR: they run payroll but cannot
  edit a package (403).
- Managers (anyone with people below them, by the manager in force) read their team at
  `/me/team` and `/me/team/:id` without pay; everyone reads only their own file in My HR.

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

## Phase 3 as built (leave, violations, inbox, self service)

Agreed with the owner on 2026-11-07; decisions taken while building are marked (chosen).

### Leave

- Data: `leave_types` (names, paid, balance `annual` | `own` | `none`, yearly days, casual
  allowance flag, document needed above N days (0 always, empty never), most days per request,
  notice days, self request, in use), `leave_requests` (LV-000001: type, from, to, half day,
  working days, note, status, manager in force when asked, who asked, on behalf, HR overrides,
  the attached note, every decision with who and when, idempotency key), `leave_request_days`
  (one row per working day: fraction 1 or 0.5, paid, the salary run that took it and how much)
  and `leave_adjustments` (HR's changes to a balance: person, type or annual, leave year, days
  plus or minus, reason, who). Grades and positions got `annual_leave_days`.
- Seeded types (the migration and the seed, HR confirms): Annual (paid, 2 days notice), Casual
  (paid, counts against annual, capped by `hr.casual_leave_days`, at most 2 days at a time),
  Sick (paid, no balance, a document above 1 day), Unpaid (no balance, 7 days notice). Types
  such as maternity, hajj or bereavement are added by HR (chosen: not seeded, their legal rules
  differ by case).
- Entitlement: the position's annual days, else the grade's, else
  `hr.default_annual_leave_days` (21). A joiner's first leave year is prorated by whole months
  from the hire month (rounded down to a half day). `hr.leave_accrual_monthly` 0 grants the
  year at its start, 1 earns it month by month (the months started so far). The leave year
  starts in `hr.leave_year_start_month` (1). What is left at a year's end carries over up to
  `hr.leave_carry_over_days` (0). (Chosen: settings hold numbers only, so the owner's
  `hr.leave_accrual monthly|yearly` became `hr.leave_accrual_monthly` 0/1.)
- Balances are never stored: annual = entitlement + carried in + adjustments − approved paid days
  of every type counted against annual (casual included); a type with its own allowance is
  allowance + its adjustments − its approved days; waiting days are shown apart and are reserved
  when a new request is checked. Casual leave must fit both its own cap and the annual balance.
- Working days: the person's roster (a shift counts, a day off not), else their default shift's
  weekdays, else Sunday to Thursday (chosen for office people without either); official holidays
  never count. A half day is one day only and counts 0.5.
- Requests: from My HR (types that allow it, with their notice) or by HR for someone (no notice;
  HR may allow more than the balance, the extra days being unpaid, and a start further back than
  `hr.leave_backdate_days` (7)). Refused: overlaps with a waiting or approved request, more than
  the balance (except types without one), more days than the type allows, no working day.
- Approval in two steps: the manager in force (HR v2: set on the file, else the department head
  chain) approves or refuses with a reason, then HR (hr use) approves, or refuses at either step.
  Without a manager in force a request goes straight to HR. Nobody decides on their own request
  (`own_request`); only the current manager in force decides the first step (`not_your_team`).
  HR's approval checks the document (`document_required`) and the balance again, then fixes
  which days are paid (unpaid types, and days beyond the balance when HR allowed that).
- Cancelling: the person while it waits; after approval only HR, with a reason, as long as no
  day reached a salary run (`leave_in_payroll`). The balance comes back by itself.
- Effects: approved days show on the roster (a "Leave" tag in the cell), the Today board shows
  the person on leave, and closed attendance days in the period are built again as on leave (a
  half day only when the person did not come in). Unpaid days reach the salary run once.

### Violations and penalties

- Data: `violation_types` (names, category: attendance, conduct, cash, damage, safety, in use)
  with `violation_steps` (the ladder: verbal or written warning, deduction in days of basic pay
  (quarters allowed), deduction in EGP (fixed, or entered when recording), suspension days,
  termination review), `violations` (VIO-000001: person, type, day, description, the step the
  ladder gave and the one applied with HR's reason, penalty, status, appeal, decision, evidence
  photo or PDF, the salary run that took it and how much) and `violation_suggestions`.
- Seeded ladders as the owner listed (late arrival: written warning, 0.25, 0.5, 1 day; absence
  without leave: 1, 2, 3 days, termination review; cash shortage and damage by negligence: the
  amount entered; misconduct: written warning, 1 day, 3 days, termination review). HR edits them;
  a changed ladder applies to new violations only.
- Recording (hr use): the step is one past the person's violations of that type (not cancelled)
  dated inside `hr.violation_period_days` (180) up to the day, staying on the last step; HR may
  choose another step with a reason. A termination review step raises one
  `hr_termination_review` alert for HR managers (no automatic termination).
- Status: recorded (the person is told) → appealed (once, by the person from My HR, with a reason,
  within `hr.appeal_days` (3) of the recording) → decided by HR manage who did not record it
  (`same_person`): upheld makes it final, cancelled ends it. Without an appeal the API's job makes
  it final once the window is over. HR manage may also decide a recorded one at once.
- Payroll: the month's salary run takes, for each employee, the final deductions not taken yet
  (made final before the month's end) and the unpaid leave days up to the month's end. A day of
  pay is the basic salary of the package in force ÷ `hr.payroll_days_per_month` (30). They reduce
  the gross before tax (chosen, as the owner asked: kept simple; the payslip lists each item);
  each row is marked with the run so it is taken once. People hired through an outsourcing
  company are never in the run: their final deductions are listed under "For outsourcing
  companies" for HR to tell the company. Suspension days are recorded only (chosen: no pay
  effect until HR confirms how suspension is paid).
- From attendance: the attendance job (every ten minutes) also suggests one violation per person
  and closed day, late past `hr.late_grace_minutes` or absent (approved leave makes a day on
  leave, never absent), with the late arrival or absence type. A day corrected since drops its
  open suggestion. HR confirms one (it is recorded on the ladder) or dismisses it in one tap.
  (Chosen: the existing `hr.late_grace_minutes` (10) is used, not a second grace of 15; HR can
  set it to 15.)

### Attendance corrections and the inbox

- `attendance_corrections` (COR-000001): the person asks from My HR for one day (what is wrong,
  the times it should show; an out at or before the in is the next day), one open request per
  day. The manager in force approves (or refuses with a reason), then HR (hr use) applies it
  through the existing corrections: a manual punch for each time, with the request number and
  the person's words as the reason, and the day is built again. HR may change the times.
- The inbox (`GET /me/inbox`, `/admin/hr/inbox` and `/my-file/inbox`): a manager sees their
  direct reports' leave and corrections at the first step, HR use sees the HR step of everyone
  in their stores and the number of open suggestions, HR manage sees appeals (not those they
  recorded). Nobody sees their own requests there. The HR menu shows the inbox count and the
  open suggestions; My HR shows the inbox count.
- Push (types `hr_request` and `hr_update`, every team member and rider): the next approver
  (the manager, then HR use of the person's stores; appeals to HR manage) and the requester at
  each decision; a recorded violation reaches the person; termination reviews reach HR manage.

### Self service (My HR)

- `/my-file/leave`: balances of the leave year, asking for leave (with a note or a medical
  document), my requests with cancel and attach. `/my-file/violations`: my violations, penalty
  and status, Appeal while the window is open. `/my-file/corrections`: ask to fix a day and
  follow it. `/my-file/inbox`: the manager inbox and my team's leave calendar.
- Payslips are not shown to the person: no payslip view for employees exists yet (the payroll
  run keeps them for Accounting with the salaries switch).

### Screens

- HR app menus: Leave (Requests, Calendar, Balances, Leave types), Violations (Violations with
  tabs Appealed, Final, For outsourcing companies and Suggested; Suggested; Violation types),
  Inbox. A request and a violation open as documents with a status bar and their history.
- The leave calendar is a month grid of people by day (approved filled, waiting dashed, half
  days ½, weekends and holidays shaded), filtered by department (with those below it) and store;
  it scrolls sideways inside its box and phones also get a list of days.
- Grades and positions edit their annual leave days.

## Phase 1 as built (usability: easier to find and use; no new business rules)

Agreed with the owner on 2026-11-07; decisions taken while building are marked (chosen). No
schema change: everything reads what the files and records already hold.

### HR home

- The HR app opens on `/admin/hr/overview` (menu Overview, the app tile and the app name lead
  there). `GET /hr/overview` (hr view, the person's store scope) returns: right now from the
  Today board (in, late, absent meaning planned and not in past the grace, on leave, not due yet,
  left, off) with who to call (absent and late, up to 8); the inbox counts (leave, day fixes,
  appeals, by the inbox's own rules) with suggested and open (recorded or appealed) violations;
  documents not in order (missing or refused, waiting for HR, running out, expired, the soonest
  six); open joining and leaving checklists with late tasks (offboarding of people who left is
  counted, chosen: the old open list hid it); probation and contract ends in the next 30 days;
  birthdays and work anniversaries (one year or more) from today to six days ahead; headcount
  of everyone not left by department and by employment. Every card has a button to act.
- Probation: the file's probation end, else the hire date plus `hr.probation_months` less a day
  (chosen: older files have no date because only new files got one filled in). Contract ends
  use `contract_ends_on`; birthdays use `birth_date` (the file already had both).

### Employee list

- `GET /hr/directory` (hr view, store scope): the directory's rows plus the documents share,
  the probation end, open violations and flags: documents missing, on probation, leaving (left
  with a last day still ahead), left, on leave today (approved leave today or the status on
  leave), open violation. Filters as before plus `flag`; sort by name, EMP code, hire date,
  department, store or documents (`dir=desc`); 50 rows a page (a page past the end shows the
  last). `flagCounts` counts each flag before the flag filter. `GET /hr/employees.csv` takes the
  same filters and sort, every page, with probation end and flags columns.
- The page keeps everything in the address (search, filters, flag, sort, page); changing a
  filter goes back to page 1. Desktop shows a table with sortable columns, phones one card per
  person; flag chips above the list filter in one tap. The four numbers that were on the
  directory moved to the HR home (chosen); the table or cards switch was replaced by the
  automatic phone cards.

### Employee file

- Header (photo, name, EMP, position, grade, manager link, department, store, status, tenure)
  with quick actions: Call, WhatsApp (wa.me with the +20 number), Upload a document, Request
  leave for them and Record a violation (hr use, not for people who left), Change status (hr
  manage) and Edit file (hr use). The list flags show under it.
- Completeness bar, "File 80% complete" (`fileCompleteness` in packages/shared, pure): photo,
  mobile, national ID, birth date, address, emergency contact (name and phone), hire date, the
  salary bank account (IBAN or account number; only for employees and only with the salaries
  switch) and each required document (verified or running out counts). It lists exactly what is
  missing; each item links to where it is fixed. The documents' own percent stays as before.
- Tabs kept in the address (`?tab=`): Overview, Job (where they work now, employment, the form
  and the history of moves built from the audit rows of the file: department, position, grade,
  manager, store, title, contract, employment), Pay (salaries switch), Documents, Attendance
  (today's plan and punches, the last 30 closed days, each opening the day), Leave (balances,
  requests, HR's adjustments, ask for them), Violations (theirs, record one), Checklists, Team
  and History. Nothing that was on the file was removed.

### Setup pages and menus

- `/admin/hr/organisation`: tabs Departments (the tree on the left: fold and unfold, head,
  headcount of the department and those below it; the selected department, kept in the address,
  shows its head, cost store, people and its positions with grade range, planned against in
  post, open places and leave days), All positions and Grades (a compact ordered table with
  bands, leave days, people, move up or down). Add and Edit open a side panel. The old
  addresses `/admin/hr/departments`, `/positions` and `/grades` redirect to the right tab.
- `/admin/hr/attendance-setup`: tabs Shifts and Official holidays (year navigation);
  `/admin/hr/shifts` and `/admin/hr/holidays` redirect.
- Menus: Overview; Employees (Employee list, Org chart, Documents to check, Joining and leaving
  checklists); Time (Today, Attendance days, Roster, Leave requests, Leave calendar, Leave
  balances); Discipline (Violations, Suggested); Inbox; Configuration (Organisation, Attendance
  setup, Leave types, Violation types, Document types, Checklist templates, Settings). Pages in
  a menu may carry a one line description (`apps.hints`), shown under the name in the menu
  (chosen: the Configuration pages).
- Every HR page uses one header (title, a plain one or two line explanation, the main action)
  and lists that can be empty show what the page is for and the first action.

## Build order

1. Employee files, documents, HR app and access, history (about 2 sessions). Built, with
   account managers (part of 5). Then HR v2 (above): organisation, grades, positions, org
   chart, photo, developed documents, onboarding, salary package and employment moved to HR.
2. Shifts, Clock in with location, attendance days and the manager board (2 sessions). Built.
3. Leave requests and balances (1 session). Built in phase 3.
4. Penalty list, violations, payroll link (1 to 2 sessions). Built in phase 3.
5. Account managers (1 session) and QC queue and scores (1 to 2 sessions).

Each step is tested, committed and put online on its own.
