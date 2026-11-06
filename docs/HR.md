# HR module (plan approved; step 1 built)

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

## Build order

1. Employee files, documents, HR app and access, history (about 2 sessions). Built, with
   account managers (part of 5).
2. Shifts, Clock in with location, attendance days and the manager board (2 sessions).
3. Leave requests and balances (1 session).
4. Penalty list, violations, payroll link (1 to 2 sessions).
5. Account managers (1 session) and QC queue and scores (1 to 2 sessions).

Each step is tested, committed and put online on its own.
