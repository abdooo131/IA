# Sales app (CRM)

The Sales app follows every brand we want as a merchant from the first contact to the signed
deal. Part 1 is the lead intake, the pipeline, deals, companies, contacts, activities and
follow up reminders (sections 1 to 7). Part 2 adds proposals with their public page, targets,
the sales dashboard and commission (sections 8 to 12). Both are built.

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
- Part 2 adds `crm_proposals` and `crm_proposal_tiers`, `crm_targets`, `crm_commissions` and
  `crm_commission_lines`, `user_setup_tokens`, and on `crm_deals` the owner at the win
  (`won_by_id`) with the commission terms of that moment (`commission_bp`,
  `commission_months`). Migration `20261226090000_sales_crm_part2`.

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
- Stage rules: any stage can move to any other (a manager can reopen a lost deal), except that
  a won deal with its merchant never leaves won (`deal_won_locked`, part 2); moving
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

## 8. Proposals (part 2)

    draft ──(discount past sales.max_discount_bp: a sales manager approves)──▶ Send
    sent ──(the brand opens /p/<token>)──▶ viewed ──▶ accepted ──(the rep confirms)──▶ deal won
      │                                     └──────▶ declined         merchant, owner, contract
      └──(sales.proposal_valid_days pass)──▶ expired
    A new version supersedes the deal's open proposals (draft, sent, viewed, accepted).

- **Numbers and versions**: `PRO-000001` onward, gapless (`nextNumber('crm_proposals')`), and a
  version per deal (1, 2, ...). Only a draft is edited; a sent proposal is changed by a new
  version, which makes the old link answer "replaced".
- **Values**: every fee starts from its global setting and the rep may change it: fee per
  delivered order (fixed and share of the products value), COD fee, failed delivery, receiving
  per unit, storage per unit per month, return per unit. Volume tiers on the order fee, the
  monthly minimum, the security deposit and the credit limit work exactly like
  `merchant_contracts`; contract start (empty: the day the rep confirms), length in months
  (empty: no end) and notice days; free text terms; orders a month and average order value for
  the example month.
- **Discount rule**: the discount of each fee (and each tier's fixed fee and share, against the
  order fee settings) is `(setting − offered) / setting`. When the largest is above
  `sales.max_discount_bp` (default 2000 = 20%) the proposal needs a sales manager's approval
  before it can be sent (`approval_required`). The rep asks (Ask a manager to approve, pushed
  to the managers); a manager who did not make it approves (`same_person` otherwise). Changing
  a price clears the approval.
- **Sending** makes an unguessable token (24 random bytes), the last day open
  (`sales.proposal_valid_days`, default 14, Cairo day) and moves the deal to the proposal stage
  when it was earlier (new, contacted, meeting), with a stage history row.
- **Public page** `/p/<token>` (no sign in, English or Arabic from the visitor's language
  cookie, switchable): our company's legal name, tax number and address (company profile), the
  rep's contact, the rates in plain words, the tiers, an example month (the expected orders at
  the average order value, every order cash on delivery, tiers applied band by band, topped up
  to the minimum, before VAT), the terms, and Accept (signer's name and title, a tick to accept
  on behalf of the brand) or Decline (name and an optional reason). Opening it marks a sent
  proposal viewed once; a proposal past its last day answers expired and refuses answers
  (`proposal_expired`); answering twice changes nothing; an answered or replaced one refuses
  the other answer (`proposal_closed`). Answers are limited to 20 per address in 15 minutes.
  The page never shows the deal, the rep's notes or other brands.
- **Confirming** (the rep, sales use, own deals): only an accepted proposal. One transaction:
  - the merchant: the company's own when it already is one (a sign up: it is approved and its
    users opened if they were waiting), else a new approved merchant named after the company,
  - its owner login: role merchant, merchant role owner, inactive with a random password, and
    a one time setup link (`/setup/<token>`, stored hashed in `user_setup_tokens`, valid
    `sales.setup_link_days`, default 7). The link is shown to the rep once to send to the
    owner (no email is sent); the rep can make a new one from the deal while the owner has not
    used it (earlier links stop working). Choosing a password opens the account,
  - the merchant contract (start, end from the length, notice, tiers, minimum, deposit, credit
    limit) through the same `saveContract` as admin, and every proposal fee as the merchant's own
    fee setting (scope `merchant:<id>`),
  - the deal's owner as the merchant's account manager (a sales manager can change it on the
    deal),
  - company and deal linked to the merchant, the deal won (with the owner at the win and the
    commission terms), its stale alerts handled,
  - every step audited (merchant.create, user.create, merchant.contract_create, settings.update,
    crm_deal.won).
  Confirming again changes nothing; any failure (for example the owner's email already used:
  `email_taken`) leaves nothing behind.

## 9. Targets

`crm_targets`: one row per rep and Cairo month with deals won, orders and fees (piastres), set
by sales managers (Sales > Targets, audited `crm_target.set`). What a rep reached:

- deals won: deals won in the month with the rep as owner at the win (`won_by_id`),
- orders brought in: delivered orders in the month of the merchants they won, from the moment
  each was won,
- fees (counted fees): fee income (fees before VAT: revenue lines tagged with the merchant, the
  year close left out) in the month of the merchants that count for them: qualified (section
  11) and inside their commission months, from the win on. This is the figure the fees target
  and the commission use.
A merchant with two won deals counts for its first win only. Reps see their own row, managers
everyone. Each row also carries the month's commission standing (hit, missed or no target, the
commission at the current level, how much more hits the target, the merchants still pending).
The fees target is what commission depends on; the deals won and orders targets are
informative. Managers see a warning listing reps (sales use, not managers) without a fees target
above 0 for the current and the next month.

## 10. Dashboard

Sales > Dashboard for a Cairo month (reps: their own numbers; managers: everyone or one rep):
open pipeline value (expected monthly fees of open deals, now) by stage, win rate (won ÷ won
and lost in the month), average days from opening to winning, new leads and their sources,
overdue follow ups (now), the funnel of the deals opened in the month (the furthest stage each
reached, with the share going on to the next stage), why deals were lost, deals won in the last
six months and the leaderboard of reps against their targets (counted fees, then deals won)
with each rep's commission standing. When it shows one rep (a rep, or a manager who picked one)
the dashboard also shows that rep's commission card (as on Commission).

## 11. Commission

The rule (agreed with the owner, replacing "5% of each won merchant's fees for 6 months"):

- Every rep has a monthly fees target (`crm_targets.fee_revenue_piastres`, section 9).
- A won merchant counts for the rep who won it (the owner at the win) only once it is active:
  it qualifies in the `sales.qualify_active_months` (default 2) distinct Cairo month, counted
  from the win, in which it had at least one delivered order (orders delivered from the moment
  of the win). Its fees count from the qualifying month on (the whole of that month); earlier
  months are never counted backwards. Until then it is shown as pending, with its active months
  (0 or 1 of 2).
- A merchant counts for `sales.commission_months` (default 12) months, the win month being
  month 1; 0 means no end.
- Each deal keeps the terms of the moment it was won: `commission_bp`, `commission_months` and
  `qualify_months` (deals won before these existed take today's settings).
- Hit or miss: once the month is over, the rep's counted fees (sum over qualified merchants inside
  their months) are compared with the rep's fees target for the month. Counted fees at or above
  a target above 0: the rep earns each deal's frozen rate on that deal's counted fees (so with
  every deal at 5% it is 5% of all the counted fees; lines may differ if the setting changed
  between wins). Below the target: 0 for the month (outcome `missed`). No target, or a target of
  0: 0 (outcome `no_target`).

Example: target 500,000 EGP; counted fees 520,000 EGP: hit, 5% = 26,000 EGP. Counted fees
480,000 EGP: missed, 0.

How it runs:

- Once a Cairo month is over (from its second day, after the month's minimum fees are booked),
  the API job works out each rep's month once (`crm_commissions`, key
  `commission:<rep>:<month>`) for every rep with a won merchant inside its months or a fees
  target: counted fees (`revenue_piastres`), the target (`target_piastres`), the outcome
  (`hit`, `missed`, `no_target`), and one line per merchant (`qualified`, `active_months`,
  `qualified_month`, fees of the month from the win on never below zero, the rate, and the
  amount: the share on a hit, 0 otherwise; pending merchants are kept as lines that are not
  qualified, their fees not counted).
- A hit with something to pay is a `draft` for a sales manager. A month that pays 0 (missed, no
  target, or nothing earned) is stored `closed`: it needs no approval, cannot be adjusted or
  approved (`commission_not_draft`) and is never paid; the record stays so the rep and managers
  see why. The database keeps a closed record at 0 and a non hit at 0.
- A sales manager approves the draft or changes the amount with a written reason, never their
  own (`same_person`; the database refuses it too). Approved commission is never changed again.
- Paying: approved commission of an employee goes into the next salary run of a month at or
  after it (Accounting > Payroll) as a taxed part of the gross (shown on the preview and the
  payslip as commission) and is marked paid by that run, once. For people hired through an
  outsourcing company Accounting pays it as a direct staff bonus (Payroll, Sales commission to
  pay), which marks it paid (`commission_not_payable` for a second time or another amount).
- Reps see the running month (Sales > Commission and the dashboard): counted fees so far against
  the target with a progress bar, how much more hits it, the commission at the current level if
  they hit it, and the merchants still pending; then their history per month (counted fees,
  target, hit or missed, commission, status). Managers see everyone's (or one rep's).

## 12. API, settings and push (part 2)

    GET    /sales/proposals                  ?status &needsApproval=true
    GET    /sales/deals/:id/proposals        versions, fee settings, the discount limit
    POST   /sales/proposals                  new version (idempotency key)
    PATCH  /sales/proposals/:id              draft only
    POST   /sales/proposals/:id/request-approval
    POST   /sales/proposals/:id/approve      sales manage, not the maker
    POST   /sales/proposals/:id/send
    POST   /sales/proposals/:id/confirm      owner name, email, mobile (a new merchant)
    POST   /sales/deals/:id/setup-link       a new owner setup link
    POST   /sales/deals/:id/account-manager  sales manage
    GET    /sales/dashboard                  ?month &ownerId
    GET    /sales/targets                    rows with the commission standing; managers: missingTargets
    POST   /sales/targets                    sales manage
    GET    /sales/commissions                ?userId (managers)
    POST   /sales/commissions/:id/adjust, /approve   sales manage, not their own
    GET    /proposal/:token, POST /proposal/:token/accept, /decline        public
    GET    /auth/setup/:token, POST /auth/setup/:token                      public
    GET    /finance/staff-commissions        approved commission of outsourced people
    POST   /finance/staff-bonuses            with commissionId to pay one

| Key | Default | Meaning |
|---|---|---|
| `sales.proposal_valid_days` | 14 | days a sent proposal stays open |
| `sales.max_discount_bp` | 2000 | largest discount (20%) without a sales manager |
| `sales.commission_bp` | 500 | commission share (5%) of the counted fees in a month the target is hit |
| `sales.commission_months` | 12 | months a won merchant counts, the win month first (0: no end) |
| `sales.qualify_active_months` | 2 | distinct months with a delivered order before a won merchant counts |
| `sales.setup_link_days` | 7 | days a new owner's setup link stays valid |

Push type `crm_proposal`: a discount waiting for approval (sales managers but its maker), the
approval (its maker), the brand's acceptance or refusal (the deal's owner).

Domain logic: packages/db/src/crm-proposals.ts and crm-sales.ts; schemas and pure rules
(discounts, example month, contract end, commission months): packages/shared/src/crm-sales.ts;
screens: apps/web/src/app/admin/sales/{proposals,dashboard,targets,commission},
components/sales/Proposal*.tsx, app/p/[token], app/setup/[token]; payroll:
packages/db/src/finance/payroll.ts.

## 13. Choices left for the owner to confirm

- No email is sent to a new owner: the rep sends the setup link. When SMTP is configured an
  email kind could carry it.
- The dashboard period is a Cairo month (not any date range).
- The example month assumes every order is cash on delivery.
- Commission is paid in the first salary run at or after the commission's month once approved
  (a late approval goes into a later run, never lost).
- A proposal's fees become the merchant's own fee settings even where they equal today's global
  value, so a later change of the global fee does not change an agreed contract.
- Notice days default to 30 when the rep leaves it empty.
- Commission against the target (choices made while building it):
  - "Active" counts orders delivered from the moment of the win (a delivery earlier in the win
    month does not count), and the qualifying month's fees count in full.
  - A month that pays 0 is closed at once (no approval, no adjustment, never paid). A manager
    who wants to pay something for such a month has no button for it; ask before adding one.
  - A target set or changed after the job has worked out a month does not change that month.
  - The targets and dashboard screens work the figures out live; the commission history shows
    what the job stored when the month closed.
  - The missing target warning lists sales people with sales use (not sales managers).
  - Existing drafts were deleted by the migration (no live commission yet); the job works out
    the month just ended again on its next run (older months are not redone).
