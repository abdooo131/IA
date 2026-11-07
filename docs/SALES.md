# Sales app (CRM)

The Sales app follows every brand we want as a merchant from the first contact to the signed
deal. Part 1 (built) is the lead intake, the pipeline, deals, companies, contacts, activities
and follow up reminders. Part 2 (planned below) adds proposals, targets, the sales dashboard and
commission.

## 1. Access

A new access app `sales` (none, view, use, manage) in `user_access`, plus the switch
`own_deals_only` (like `own_merchants_only`):

| Level | What it allows |
|---|---|
| view | read the pipeline, deals, companies, contacts, activities, My day |
| use | add leads, companies and contacts, change stages, log and plan activities, edit details |
| manage | everything, every deal; give deals to reps (or back to the queue); lost reasons list |

With `own_deals_only` (sales reps) a person sees and changes only their own records: deals they
own, companies they own or own a deal of, activities they own or that sit on their deals. Any
route naming another person's record answers 403 `{ error: 'deal_not_allowed' }`. A manager
(sales manage) always sees everything, whatever the switch says. A rep can only name themselves
as an owner (`owner_not_allowed`); only sales people (sales use or manage, active) can own
records (`owner_not_sales`).

Job roles: **Sales rep** (merchants view, sales use, own deals only), **Sales manager**
(merchants view, sales manage). The **Owner** job role has sales manage. The migration gave
sales manage to every profile with settings manage and none to the rest.

The sales settings live in Sales > Configuration > Settings (`/admin/settings/sales`, settings
manage like every app's settings); the lost reasons list in Sales > Configuration > Lost
reasons (sales manage).

## 2. Data (tables `crm_*`)

- `crm_companies`: brand name, website, Shopify domain, category, city, expected orders a
  month, source (`website_form`, `signup`, `manual`, `referral`, `event`, `other`), note, owner
  (null: the managers' queue), `merchant_id` once the brand is a merchant, `site_lead_id` for
  website leads.
- `crm_contacts`: company, name, role, phone, `phone_valid`, email, WhatsApp flag. A valid
  Egyptian mobile is stored as +20 and 10 digits; anything else is kept as typed and flagged,
  as on the website form.
- `crm_deals`: gapless number shown as `DEAL-000001` (`nextNumber('crm_deals')` under an
  advisory lock), company, owner (with when and by whom it was given, and whether the round
  robin gave it), stage (`new`, `contacted`, `meeting`, `proposal`, `negotiation`, `won`,
  `lost`), expected orders a month, expected monthly fees in piastres, expected close date,
  lost reason and note, `stage_changed_at`, `won_at`, `lost_at`, `merchant_id`, idempotency
  key. CHECKs: amounts not negative, lost needs a reason and `lost_at`, the reason `other`
  needs a note, won needs `won_at`.
- `crm_deal_stage_history`: every stage a deal entered, who and when (append only trigger).
- `crm_activities`: company and optionally deal, type (`call`, `meeting`, `whatsapp`, `email`,
  `note`, `task`), subject, notes, `due_at`, `done_at`, outcome, owner, created by,
  `due_notified_at` (reminder sent), idempotency key. CHECK: an activity is either done or has
  a due date.
- `crm_lost_reasons`: code, English and Arabic labels, active, order. Starts with price, not on
  Shopify, too few orders, customers outside our areas, chose a competitor, stopped answering,
  not ready yet. Managers add reasons and switch them off (a switched off reason stays on old
  deals). `other` is always offered and needs a note.
- Part 2 adds `crm_proposals`, `crm_targets` and `crm_commissions` (not built).

Every change is audited (`crm_deal.*`, `crm_activity.*` on the deal or company,
`crm_company.*`, `crm_contact.*`, `crm_lost_reason.*`).

## 3. Leads coming in

- **Website form** (POST /site/leads): `site_leads` stays the raw record of what the visitor
  sent (name, phone, website, orders band, language). In the same transaction it opens a
  company (named after the website's host, else the person), the person as a contact and a
  deal at stage new with the band's estimate of orders a month (under 300: 150, 300 to 1,000:
  650, 1,000 to 5,000: 3,000, over 5,000: 5,000), plus the `site_lead` alert. The follow up
  columns (status, note, handled by) moved to the CRM: the migration copied every existing
  website lead into a company, contact and deal (status kept as the stage; lost ones got the
  reason `other` with their note; the note went to the company) and dropped those columns.
- **Merchant sign up** (POST /auth/signup): opens a company (source signup, linked to the new
  merchant, Shopify domain when given), the applicant as contact (mobile and email) and a deal
  linked to the merchant. The `merchant_signup` alert for merchants manage stays as before.
- **By hand**: a rep adds a lead (new company with its first contact, or a new deal for a
  company we have) at /admin/sales/new. A rep's lead is theirs; a manager's waits in the queue
  unless they pick an owner.
- **Assignment**: new leads go to the sales managers' queue unassigned (Sales > Leads, "Waiting
  to be assigned"); the manager gives each to a rep. With `sales.auto_assign` = 1 (default 0)
  website and sign up leads go round robin to the active sales reps (sales use): the rep after
  the one who got the last automatic lead, in a fixed order; a disabled rep is skipped.
- The old Merchants > Leads page is gone; /admin/leads sends people to /admin/sales/leads.

## 4. Pipeline, deals and companies

- **Board** (/admin/sales/pipeline): one column per stage with the count and the monthly fee
  value. Each card shows the company, deal number, owner, expected orders a month, monthly
  fee value, days in the current stage and the next step's date (red when overdue, a "No next
  step" flag when an open deal has none). Cards are dragged to another column with a mouse, or
  moved with each card's "Move to" list (keyboard and phones). Moving to Lost opens the reason
  dialog. Filters: owner (people who see every deal), source, search (company, website,
  contact name, phone, or the DEAL number); won and lost columns can be hidden.
- **List** (/admin/sales/deals): the same deals as a table, a "Needs a next step" tab, and
  Export to Excel (GET /sales/deals.csv: UTF-8 byte order mark, cells starting with = + - @
  neutralised, money in EGP with two decimals, times in Cairo).
- **Deal page** (/admin/sales/deals/<id>): document style, with the status bar of the stages
  (lost in red), Back, the next step banner when there is none, actions (move to the next
  stage, mark lost with a reason, stage list, owner for managers), details (editable), the
  activity timeline newest first with Log what happened / Schedule next step, the company card
  with its contacts (tap to call, WhatsApp link for Egyptian mobiles), the stage history and
  the History panel (audit log, served by GET /sales/deals/:id/history after the same scope
  check, so a rep never reads another rep's history).
- **Company page** (/admin/sales/companies/<id>): details, contacts (add), its deals, its
  activities, New deal for this company. Companies list with search.
- Stage rules: any stage can move to any other (a manager can reopen a lost deal); moving
  keeps a history row, stamps `won_at` or `lost_at` and clears them when the deal leaves won or
  lost, and handles the deal's open stale alert.
- Reassigning (sales manage): the deal gets the new owner; the company follows when it had no
  owner or the old one; the old owner's open follow ups on the deal move to the new owner.

## 5. Follow ups and reminders

- Every open deal should have a next step: an open activity with a due date. The earliest one
  is the deal's next step on the board, the list and the deal page.
- **My day** (/admin/sales/my-day): the signed in person's open follow ups that are overdue or
  due today (Cairo day), and their open deals without a next step. People who see every deal
  can switch to one rep or everyone.
- The API job (every 30 seconds, `runCrmReminders`, safe to run twice):
  - a follow up that became due (in the last day) is marked once (`due_notified_at`); the push
    dispatcher then tells its owner ("Follow up now"),
  - one `crm_followup_overdue` alert per follow up still open `sales.overdue_minutes` (default
    60) after it was due (key `crm_followup_overdue:<activity>`), pushed to the owner,
  - one `crm_deal_stale` alert per deal and stay in a stage longer than `sales.stale_days`
    (default 14) (key `crm_deal_stale:<deal>:<stage>:<entered at>`), pushed to the owner (the
    managers when nobody owns it).
  - Marking the follow up done (or moving its date) handles its overdue alert; moving the deal
    handles its stale alert.
- CRM alerts show in Operations > Alerts only to sales managers.
- Push (packages/db/src/push.ts, words in packages/shared/src/push.ts in English and Arabic):
  `site_lead` (website lead: the sales managers, or the rep the round robin chose), `crm_lead`
  (a deal given to you by a manager or the round robin; a new non website lead waiting in the
  queue goes to the managers), `crm_followup` (due, overdue, stale). Only people who may still
  open sales records receive them.

## 6. API

All under /sales, `@Access('sales')` (GET view, changes use):

    GET    /sales/meta                       sales people, active lost reasons, my level
    GET    /sales/deals                      ?ownerId &unassigned &source &stage &open &needsNextStep &q
    GET    /sales/deals.csv                  same filters, CSV
    POST   /sales/deals                      new lead / deal (idempotency key)
    GET    /sales/deals/:id                  deal with company, contacts, activities, stages
    GET    /sales/deals/:id/history          audit rows of the deal
    PATCH  /sales/deals/:id                  title, numbers, close date, merchant
    POST   /sales/deals/:id/stage            stage (lost: lostReason, lostNote)
    POST   /sales/deals/:id/owner            sales manage: ownerId or null
    POST   /sales/activities                 log (done) or plan (dueAt) (idempotency key)
    PATCH  /sales/activities/:id             subject, notes, due date, outcome
    POST   /sales/activities/:id/done        outcome
    GET    /sales/my-day                     ?ownerId | ?all=true (people who see every deal)
    GET    /sales/companies, /sales/companies/:id
    POST   /sales/companies                  (idempotency key)
    PATCH  /sales/companies/:id
    POST   /sales/companies/:id/contacts
    PATCH  /sales/contacts/:id
    GET    /sales/lost-reasons               every reason (configuration)
    POST   /sales/lost-reasons, PATCH /sales/lost-reasons/:code   sales manage

Domain logic: packages/db/src/crm.ts. Schemas and pure rules: packages/shared/src/crm.ts.
Screens: apps/web/src/app/admin/sales, components/sales, lib/sales.ts.

## 7. Settings

| Key | Default | Meaning |
|---|---|---|
| `sales.auto_assign` | 0 | 1: website and sign up leads go round robin to the active sales reps |
| `sales.overdue_minutes` | 60 | minutes after the due time before a follow up is overdue (alert) |
| `sales.stale_days` | 14 | days in one stage before a deal is stale (alert) |

## 8. Part 2 (planned, not built)

- **Proposals** (`crm_proposals`): built from the fee settings (fixed fee and percent per
  order, COD fee, failed delivery fee, receiving and storage) with the contract's volume tiers
  and monthly minimum, sent to the merchant as a link they accept online. When accepted, the
  rep confirms and the system opens the merchant, its contract (merchant_contracts) and the
  owner login, links company and deal to the merchant and marks the deal won.
- **Targets** (`crm_targets`): per rep per month: deals won, orders brought in (delivered
  orders of the merchants they won) and fee revenue from the ledger (fees before VAT).
- **Dashboard**: funnel by stage, conversion between stages, pipeline value, win rate, average
  days to close, lost reasons, leaderboard against targets.
- **Commission** (`crm_commissions`): by default 5% of the won merchant's fees before VAT for 6
  months after the win (settings `sales.commission_bp` = 500 and `sales.commission_months` =
  6), computed monthly from the ledger, approved by the sales manager, and paid through the
  payroll run as a taxed bonus.
- Menus to add: Proposals, Targets, Dashboard, Commission.
