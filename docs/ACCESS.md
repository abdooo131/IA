# Access rights (agreed with the business)

Odoo style: what a person may open and do is set per app, per person, with ready made job
roles that fill the settings in one click.

## Who is who

`users.role` stays as the kind of account:

- `admin`, `finance`, `store_staff`: **team members**. What they may do comes from their
  access profile below, not from the role. The role only decides where they land after
  signing in (`/home` for admin and finance, their store for store staff).
- `rider`: unchanged (the rider app, their own deliveries).
- `merchant`: a merchant's user, with owner or member rights (below).

## Team member access profile

One row per team member (`user_access`):

| Field | Values |
|---|---|
| `job_role` | the job role it was last filled from (label only), or `custom` |
| `store` (store screens) | none, use, manage |
| `operations` | none, view, use, manage |
| `inventory` | none, view, use, manage |
| `merchants` | none, view, use, manage |
| `customers` | none, view, use, manage |
| `accounting` | none, view, use, manage (view, prepare, approve in finance words) |
| `hr` | none, view, use, manage |
| `sales` | none, view, use, manage |
| `settings` | none, manage |
| `all_stores` | true, or the listed stores only (`user_stores`) |
| `customer_data` | may open named customer profiles (off unless given) |
| `salaries` | may see salaries, payslips and the payroll run (off unless given) |
| `own_merchants_only` | account managers: only the merchants whose account manager they are |
| `own_deals_only` | sales reps: only their own companies, deals and activities (docs/SALES.md) |

Levels are ordered none < view < use < manage. A GET needs view, a change needs use, and
routes that approve, close, undo or configure need manage.

What each app covers:

- **store**: the store staff screens under `/stores/:storeId/*` (orders to pick and pack,
  hand to rider, receive, put away, transfers, returns, counts, damage, cash handover).
  manage: things a store lead approves on the floor (none today; kept for later).
- **operations**: orders (admin), alerts, live stores, dashboard and KPIs, zones, store hours
  and capacity, addresses and the area engine. manage: zones, hours, capacity, stores and
  hubs, area import and address approvals, cancelling after pick.
- **inventory**: stock, shipments, transfers, returns, damage reports, counts, refill.
  manage: approve or cancel transfers and refill drafts, approve counts, settle damage.
- **merchants**: merchants, products, Shopify stores and apps. manage: approve sign ups, link,
  connect or disconnect Shopify, add apps, fees per merchant. (The website leads moved to the
  Sales app.)
- **customers**: market data and customer summaries. Named profiles also need
  `customer_data`. manage: merge profiles.
- **accounting**: everything under `/finance`. view = reports only, use = prepare, manage =
  approve (second person rule, closing books, year end). Salary pages also need `salaries`.
- **hr**: employee files, the organisation (departments, positions, grades, org chart), documents
  and document types, onboarding and offboarding checklists, employment and salary packages,
  history, document expiry alerts and attendance (docs/HR.md). view reads files, the org chart,
  the configuration, documents of types that are not confidential, the Today board, attendance
  days and the roster; use changes files, employment, photos, uploads and verifies documents
  (confidential types need use), ticks checklist tasks, plans the roster and corrects attendance
  (manual punches, voiding a punch, a day's status); manage opens a file for an account without
  one, changes the status (left disables the account and starts offboarding), deletes documents,
  cancels checklists and changes departments, positions, grades, document types, checklist
  templates, shifts and official holidays. The salary package and the salary bank account also
  need `salaries` (read with view, change with use). HR owns people: Accounting reads packages to
  pay them and cannot change them. Clocking in and out and reading one's own attendance need no
  access (every team member and rider).
  HR phase 3: view also reads leave requests, the leave calendar and balances, leave and
  violation types, violations, suggested violations and attendance correction requests; use
  asks for leave for someone (with the balance and backdate overrides), approves or refuses at
  the HR step, cancels approved leave, adjusts balances with a reason, records violations (and
  their evidence), confirms or dismisses suggestions and applies or refuses attendance fixes;
  manage edits leave types and violation ladders and decides appeals (upholds or cancels; never
  a violation they recorded: `same_person`). Nobody decides on their own request or violation
  (`own_request`, `own_violation`). Deduction amounts computed by the salary run stay with the
  salaries switch (payroll and payslips); the penalties themselves are HR data.
- **sales**: the CRM (docs/SALES.md): leads from the website form and sign ups, the pipeline,
  deals, companies, contacts, activities and My day. view reads, use adds leads and companies,
  moves deals, logs and plans activities; manage sees every deal whatever `own_deals_only`
  says, gives deals to reps (or back to the queue) and edits the lost reasons. With
  `own_deals_only` any route naming another person's record answers 403
  `{ error: 'deal_not_allowed' }`. The sales settings page needs settings manage like every app.
  Part 2: proposals follow their deal (a rep only on their own deals); use makes, edits, sends
  and confirms them, and confirming opens the merchant, its owner login and contract even for a
  rep without merchants manage (only through that flow). manage approves discounts past
  `sales.max_discount_bp` (never on a proposal they made: `same_person`), sets targets, approves
  or adjusts commission (never their own: `same_person`) and changes a won merchant's account
  manager. The dashboard, targets and commission show a rep only their own numbers; managers
  see everyone. Accounting (use with salaries) pays an outsourced rep's approved commission as a
  direct bonus; employees get theirs in the salary run, which Accounting never changes.
  The proposal page `/p/<token>` and the owner's setup page `/setup/<token>` are public (the
  unguessable token is the key; answers limited to 20 per address in 15 minutes).
- **settings**: users and access, audit log, ticket settings, and the settings pages of every
  app (a setting is changed with settings manage).

Store scope: a person without `all_stores` sees only their listed stores in every app: store
screens, orders, stock, transfers, cash, alerts and the live board are filtered or refused
(`store_not_allowed`).

## Job roles (templates)

| Job role | store | operations | inventory | merchants | customers | accounting | hr | sales | settings | stores | customer data | salaries | own merchants only | own deals only |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Owner | manage | manage | manage | manage | manage | manage | manage | manage | manage | all | yes | yes | no | no |
| Operations manager | manage | manage | manage | view | view | none | none | none | none | all | no | no | no | no |
| Store manager | manage | use | use | none | none | none | view | none | none | listed | no | no | no | no |
| Store staff | use | none | none | none | none | none | none | none | none | listed | no | no | no | no |
| Hub staff | use | none | view | none | none | none | none | none | none | listed | no | no | no | no |
| Dispatcher | use | use | view | none | none | none | none | none | none | all | no | no | no | no |
| Customer service | none | use | view | view | view | none | none | none | none | all | yes | no | no | no |
| Accountant | none | view | view | view | none | view | none | none | none | all | no | no | no | no |
| Finance officer | none | view | view | view | none | use | none | none | none | all | no | no | no | no |
| Finance manager | none | view | view | view | none | manage | none | none | none | all | no | yes | no | no |
| HR officer | none | none | none | none | none | none | manage | none | none | all | no | no | no | no |
| HR manager | none | none | none | none | none | none | manage | none | none | all | no | yes | no | no |
| Account manager | none | view | view | use | view | none | none | none | none | all | no | no | yes | no |
| QC agent | use | none | view | none | none | none | none | none | none | listed | no | no | no | no |
| Sales rep | none | none | none | view | none | none | none | use | none | all | no | no | no | yes |
| Sales manager | none | none | none | view | none | none | none | manage | none | all | no | no | no | no |

QC agent holds the same values as Hub staff until the QC queue (HR step 5) gives it its own
screens; the stored job role label keeps them apart.

Picking a job role overwrites every field; the person can then be adjusted (job role becomes
`custom`).

## Safety rules

- Only a person with settings manage can change anyone's access, and never their own.
- At least one active person must keep settings manage (the last one cannot be lowered or
  disabled): `last_owner`.
- Every change is audited with before and after.
- The server checks every route; hiding a menu is never the only protection. A refusal
  answers 403 `{ error: 'no_access' }` (or `store_not_allowed`).
- Access is read fresh on every request, so a change applies at once without signing out.

## Merchant team

`users.merchant_role`: `owner` or `member`. Members have a list of rights
(`users.merchant_rights`): `orders`, `stock` (shipments, products, returns, damage),
`money` (wallet, payouts, statements, invoices, bank details), `settings` (Shopify, 60 minute
price, tax details, payout schedule). Owners have all rights and manage the team at
`/merchant/team` (add, change rights, disable, reset password); an owner cannot remove
themselves, and a merchant always keeps one active owner.

## Account managers (docs/HR.md 5)

A merchant has one account manager (`merchants.account_manager_id`, set by merchants manage on
the merchant page). A person with `own_merchants_only` sees only the merchants they look after:
the merchants list, products, stock, shipments, orders (list, detail, CSV, cancel), merchant fee
settings and alerts are filtered, and any route naming another merchant (`:merchantId`,
`?merchantId=`, a merchant's `:id`) answers 403 `{ error: 'merchant_not_allowed' }`. Alerts tied
to a merchant (`alerts.merchant_id`, or the order's merchant) go to them. A merchant they create
is theirs.

## Moving existing users

- admin → Owner profile.
- HR step 1: the new hr column starts at manage for the Owner job role and none for everyone
  else; `own_merchants_only` starts off.
- Sales CRM part 1: the new sales column starts at manage for every profile with settings
  manage (owners) and none for everyone else; `own_deals_only` starts off.
- Sales CRM part 2: no new column; deals already won count for the person who owned them
  (`won_by_id`).
- HR step 2: Store managers get hr view (their stores' attendance board, roster and days); the
  migration raises existing Store manager profiles from none to view.
- HR phase 3: no new column; the hr levels above cover leave and violations. Store managers (hr
  view) read their stores' leave and violations and approve only as managers in force.
- HR phase 1 (usability): no new column. The HR home (`GET /hr/overview`), the employee list
  (`GET /hr/directory`) and a file's completeness are hr view, inside the person's stores like
  every HR list; the inbox counts on the home follow the inbox's own rules.
- HR phase 2 (guided flows): no new column. The new hire wizard (drafts, their photo and
  documents, create, a new setup link) is hr use; its pay step and the "waiting for pay" list
  need `salaries`. The leaving wizard, its preview and giving a leaver's things a new owner are
  hr manage; the "Needs a new owner" list and the expiry calendar are hr view; document
  reminders are hr use. Everything stays inside the person's stores.
- finance → Finance officer (finance_level prepare or view: accounting use or view) or
  Finance manager (approve).
- store_staff → Store staff for their own store.
- merchant users → owner (the first) ; any further users of the same merchant become owner
  too, so nobody loses access; the owner can lower them.

## Decisions taken while building the server side

These were left open above and decided in the code; change them here first if the business
wants otherwise.

- Moving existing users: finance users at level view get exactly the Accountant row
  (accounting view), so they are labelled `accountant`.
- New team members without a job role: admin accounts start as Operations manager, finance
  accounts as Finance officer (or Finance manager / Accountant when the old finance level
  approve / view is sent), store staff as Store staff of their own store. A team member without
  a profile row opens nothing. A profile limited to listed stores needs at least one store
  (`stores_required`).
- Settings: every team member may read the settings (their app pages show them); changing one
  needs settings manage. A merchant's own prices and terms are no longer settings (merchant
  contracts v2): the `merchant:<id>` scope is refused (`scope_not_allowed`).
- Merchant contracts (v2): merchants view and accounting view read a merchant's contract, its
  versions, signed files and printed copies (`/admin/merchants/:id/contract*`); only merchants
  manage writes drafts, activates them (audited with before and after), attaches or removes
  signed files and edits the payout bank account from the contract (`PUT
  /admin/merchants/:id/bank`; Accounting keeps its own `PUT /finance/merchants/:id/bank`).
  Payment terms are part of the version, so they follow the same rule: Accounting reads them
  but does not activate a version (choice to confirm with the owner). People limited to their
  own merchants (`own_merchants_only`) reach only those merchants' contracts. The merchant's
  users with the money right read their own contract and its PDF (`/merchant/contract`,
  `/merchant/contract/pdf`), never drafts, signed files or the team's internal note.
- Owner only, as before: posting opening balances and creating the e-invoice signer key need
  accounting manage and settings manage. Reopening closed books (moving the lock date back)
  needs settings manage.
- Salaries (HR v2): the salary package and employment are kept in HR. Setting a package needs
  hr use and `salaries` (an HR officer with the salaries switch, or the HR manager job role);
  employment needs hr use. Staff pay (read only), payslips, the payroll run (and its preview),
  advances, staff bonuses and the monthly salary tax lists need the matching accounting level
  and `salaries` (the Finance manager runs payroll); accounting alone never changes a person.
- Managers: anyone with people below them (by the manager in force, docs/HR.md) reads their team
  at `/me/team` and each member's file at `/me/team/:id` without pay, bank details, ID numbers or
  documents, whatever their access profile. Everyone reads only their own file in My HR, may set
  their photo and may send a missing or refused document (HR verifies it). A person's photo
  (`/people/:id/photo`) is open to themself, their managers and HR view within their stores.
- Customers: the customer list (it shows names and phones), the person behind an order and a
  profile need `customer_data`; the overview and districts need customers view only; merging
  needs customers manage and `customer_data`. The Shopify data pages (market, per merchant) are
  customers view; collecting a store again is customers use.
- Operations: cancelling an order before picking starts (new, accepted) needs operations use,
  after that operations manage. Address lookups are use; approving suggestions, adding area
  names and the area import are manage.
- Inventory: transfers, returns and counts follow "approve or cancel = manage"; creating a
  transfer, refill targets and preparing refill drafts are use. A transfer can be created only
  from one of the person's stores.
- Merchants: Shopify link, apps, connect, disconnect, locations and the checkout rate are
  manage; syncing products or a store now is use. Creating or editing merchants and products
  is use; approving or rejecting sign ups is manage.
- Lookups read by every app (stores list, merchants list, settings) need any team access; the
  locations list is not open to people who only have the store screens, and is filtered to the
  person's stores.
- Record history follows the record's app (orders in operations, transfers in inventory,
  money records in accounting, merchants in merchants or accounting); users, settings and
  anything not listed need settings manage.
- Proof photos: pack and delivery photos need store use or operations use, receipt photos
  accounting use. Tickets stay open to every team member and rider by role.
- Merchant members: every member may read their merchant's details, notifications, products
  (the order form needs them), stores and the 60 minute price; changing the price and the payout
  schedule needs `settings`.
- Cash controls: handing a cash order to a rider past the store's cash limit needs store manage
  (a store manager) with a written reason (audited). Petty cash is store use (the form, and
  uploading the receipt photo); its categories are accounting use, reversing a petty expense is
  accounting manage, and approving a waiting one goes through Approvals like every request.
  The cash position is accounting view; a person limited to some stores sees only those stores'
  boxes and riders, without banks, merchants, bills or the net position. The month end
  checklist is accounting view to read and use to tick or untick an item.
- HR phase 3 (leave, violations, inbox): every team member and rider asks for leave, reads their
  balances, appeals their own violations and asks to fix an attendance day from My HR without
  any access level (`/me/leave`, `/me/violations`, `/me/corrections`; merchants get 404).
  Managers (anyone with people below them by the manager in force) approve or refuse the first
  step of their direct reports' leave and attendance fixes from the inbox (`/me/inbox`,
  `/me/inbox/...`; anyone else gets `not_your_team`), read their team's requests
  (`/me/team-leave/:id`, direct and indirect) and their team's leave calendar
  (`/me/team-leave-calendar`), whatever their access profile. HR items in the inbox follow the
  person's HR level read fresh (use: the HR step and suggestions; manage: appeals). People
  limited to listed stores see and act on those stores' people only (`store_not_allowed`).
- HR phase 2, the new hire wizard's access step (decided while building): HR use may create a
  login and pick its job role, store scope and switches, but settings manage (the Owner job
  role) is given only by someone who holds settings manage (`access_needs_settings`), the
  salaries switch only by someone who has it (`salaries_required`), named customer profiles only
  by someone who has them or settings manage, and a person limited to some stores hires only
  into their stores and gives only those (`store_not_allowed`). Changing access afterwards stays
  in Settings > Users (settings manage).
