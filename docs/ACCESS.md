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
| `settings` | none, manage |
| `all_stores` | true, or the listed stores only (`user_stores`) |
| `customer_data` | may open named customer profiles (off unless given) |
| `salaries` | may see salaries, payslips and the payroll run (off unless given) |
| `own_merchants_only` | account managers: only the merchants whose account manager they are |

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
- **merchants**: merchants, products, Shopify stores and apps. manage: approve sign ups,
  link, connect or disconnect Shopify, add apps, fees per merchant.
- **customers**: market data and customer summaries. Named profiles also need
  `customer_data`. manage: merge profiles.
- **accounting**: everything under `/finance`. view = reports only, use = prepare, manage =
  approve (second person rule, closing books, year end). Salary pages also need `salaries`.
- **hr**: employee files, their documents and history, document expiry alerts, attendance
  (docs/HR.md). view reads files, the Today board, attendance days and the roster; use changes
  files, adds documents, plans the roster and corrects attendance (manual punches, voiding a
  punch, a day's status); manage opens a file for an account without one, changes the status
  (left disables the account), deletes documents and changes shifts and official holidays.
  Salary and the salary bank account also need `salaries`. Clocking in and out and reading
  one's own attendance need no access (every team member and rider).
- **settings**: users and access, audit log, ticket settings, and the settings pages of every
  app (a setting is changed with settings manage).

Store scope: a person without `all_stores` sees only their listed stores in every app: store
screens, orders, stock, transfers, cash, alerts and the live board are filtered or refused
(`store_not_allowed`).

## Job roles (templates)

| Job role | store | operations | inventory | merchants | customers | accounting | hr | settings | stores | customer data | salaries | own merchants only |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Owner | manage | manage | manage | manage | manage | manage | manage | manage | all | yes | yes | no |
| Operations manager | manage | manage | manage | view | view | none | none | none | all | no | no | no |
| Store manager | manage | use | use | none | none | none | view | none | listed | no | no | no |
| Store staff | use | none | none | none | none | none | none | none | listed | no | no | no |
| Hub staff | use | none | view | none | none | none | none | none | listed | no | no | no |
| Dispatcher | use | use | view | none | none | none | none | none | all | no | no | no |
| Customer service | none | use | view | view | view | none | none | none | all | yes | no | no |
| Accountant | none | view | view | view | none | view | none | none | all | no | no | no |
| Finance officer | none | view | view | view | none | use | none | none | all | no | no | no |
| Finance manager | none | view | view | view | none | manage | none | none | all | no | yes | no |
| HR officer | none | none | none | none | none | none | manage | none | all | no | no | no |
| Account manager | none | view | view | use | view | none | none | none | all | no | no | yes |
| QC agent | use | none | view | none | none | none | none | none | listed | no | no | no |

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
- HR step 2: Store managers get hr view (their stores' attendance board, roster and days); the
  migration raises existing Store manager profiles from none to view.
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
  needs settings manage, except a merchant's own fees (`merchant:<id>` scope), which merchants
  manage may also change.
- Owner only, as before: posting opening balances and creating the e-invoice signer key need
  accounting manage and settings manage. Reopening closed books (moving the lock date back)
  needs settings manage.
- Salaries: setting a salary or employment type needs accounting manage and `salaries`; staff
  pay, payslips, the payroll run (and its preview), advances, staff bonuses and the monthly
  salary tax lists need the matching accounting level and `salaries`.
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
