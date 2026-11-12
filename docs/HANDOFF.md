# Handoff: where work stands (2026-11-10)

## Live on Render (branch ShiplyNow)

Shiply Now only. The merge with the Shiply parcel network was undone at the owner's request on
2026-11-09; the merged version is kept on the branch `claude/shiply-merge-archive` and its data in
the Neon backup `backup-before-shiplynow-only-2026-11-09`.

- Public website (Home, How it works, For brands, Contact; Our team hidden until people are sent)
- Operations, Inventory, Merchants, Customers, Sales, HR, Accounting (phase A) and Settings
  (phase B is built on its branch and waits for deployment)
- Merchant contracts v2 with contract pricing, rider pay per delivery with the wallet
- Database: `shiplynow_live` (the only database on the server), filled with the demo month.
  The service setting DATABASE_NAME points the app at it; deploy/prepare.mjs loads the starting
  data and the demo month alone before the servers start (512 MB instance).

## Accounting UX phase B: built (branch claude/accounting-ux-b, not deployed)

Drill down reports (P&L, balance sheet, trial balance: account → lines → entry; period presets,
comparison, store and merchant filters, PDF in English or Arabic, CSV and Excel), the bank
matching screen (suggestions, one click and multi line match, bank charge through the second
person rule, set aside with a reason, keyboard), the "Pay merchants" guided run, the "Close the
month" guided run, the "Record an expense" form, and the menu and dashboard links. CLAUDE.md has
the decision line "Accounting UX phase B". Choices made while building it that the owner should
confirm: the quick expense form takes the note as the reference when none is typed; a payout run
marked paid with a past day is booked at noon of that day; near amounts (within 5%) and parts are
only suggestions and never matched; a filtered (store or merchant) balance sheet or trial balance
need not balance and says so.

## UX phase C step 1 (Operations): built (branch claude/ux-phase-c, not deployed)

The Accounting building blocks now serve every app: one list query helper
(packages/db/src/list-query.ts), APP_LISTS (packages/shared/src/app-lists.ts) answered by
GET /lists/<app>/<id>, value filters (store, merchant, first and last Cairo day) in the list
engine and the Filters menu, and DocumentFrame (components/odoo/DocumentFrame.tsx), the frame of
every document page. Built on it: the Orders list (search, filters, value filters, grouping,
totals, favourites, columns, CSV and Excel, phone cards, bulk Accept and Cancel with a reason),
the order page framed as a document (breadcrumbs, previous and next, smart buttons, chatter
beside it from xl), the Alerts list (bulk Mark as handled), the Damage reports list and a damage
report document page (/admin/damage/<id>). CLAUDE.md has the decision line "UX phase C step 1
(Operations)". Choices the owner should confirm:

- Bulk Accept lets Operations use people accept new orders from the list (before, only store
  staff accepted, one by one in the store screen); each order is still checked against the
  person's stores.
- The order's chatter shows the order's team notes (order_notes, team thread) instead of the
  generic record notes, so an order has one internal thread; the merchant thread stays in the
  Notes card of the details tab. The change history moved from the tracking tab to the chatter.
- Damage reports stay in the Inventory app (menus and access unchanged), though built in this
  step.
- Old list links (/admin/orders?status=..., /admin/alerts?all=1, /admin/damage?status=settled)
  now open the list with its default filters; the dashboard's store queue link was updated.

## UX phase C step 2 (Inventory): built (branch claude/ux-phase-c, not deployed)

The Inventory app on the same building blocks: list views for stock (per store and product,
low and out of stock, unit totals), shipments in (still to receive, more or fewer than listed),
transfers (sender, receiver, final destination, sent or arrived short, automatic refill),
returns to merchants (sellable, damaged or held units) and stock counts (opens on waiting);
document pages for a shipment, a transfer, a return and a stock count (new page
/admin/counts/<id>) with smart buttons and the chatter; bulk Approve of draft transfers and of
stock counts. CLAUDE.md has the decision line "UX phase C step 2 (Inventory)". Choices the owner
should confirm:

- Bulk Approve of transfers takes the drafted quantities as they are (only the automatic
  refill makes drafts; admin's own transfers are approved when created). To change quantities,
  open the transfer as before.
- Bulk Approve of counts applies each count's differences; a bin that changed since its count
  makes that count stale (count again) and the list says so for that row. There is no bulk
  Reject.
- A stock row opens the merchant's products page searched by the SKU (there is no product
  document page yet). Stock has no value column (it was not shown before) and no category
  grouping (products have no category).
- Shipment "short" counts only once a shipment is received (closed); while receiving, missing
  units are not short yet.
- Transfers and stock counts have no merchant, so account managers limited to their merchants
  still see them (as before); returns now refuse other merchants' returns like shipments do.
- The counts list opens on counts waiting for approval; remove the filter to see reviewed ones
  (before, the page showed the last 20 reviewed below the waiting ones).

## Waiting on the owner

- Proposal PDF: yes or no
- Our team page: people, roles, achievements, photos
- Render settings: VAPID keys (phone notifications), SMTP (merchant emails)
- Nightly backup workflow on main: approval
- HR person or lawyer to check leave and penalty defaults
- Real merchants and their contract prices (the live data is demo data)
- Several "choices to confirm" listed in CLAUDE.md decision lines (rider pay, contracts, pricing)

## UX phase C step 3 (Merchants and Customers): built (branch claude/ux-phase-c, not deployed)

List views for merchants (sign up, Shopify, 60 minute price, contract in force, wallet,
account manager; bulk approve sign ups, pause and open again), products (active, Shopify link,
available to sell, barcode; per merchant) and customers (segments, cash risk, due to order
again, bought from a merchant, district; customer data only). Document pages for a merchant
(the existing tabs inside the frame, status bar, actions, smart buttons, chatter), a new
product page (/admin/products/<id>) and the customer profile. No migration. CLAUDE.md has the
decision line "UX phase C step 3 (Merchants and Customers)". Choices the owner should confirm:

- Pause and open again in bulk only touch approved merchants; a sign up still opens through
  Approve. The panel of sign ups waiting (with Reject and its reason) now shows only to people
  who may decide (merchants manage).
- "Contract in force" is the latest activated version started by today whose end date has not
  passed. "Shopify connected" means the store finished installing (active), not only linked.
- The merchants list's wallet column and totals (what we owe; below 0 the merchant owes us) are
  shown to Merchants view, as the merchant page's overview already did; the wallet smart button
  (to the Accounting wallet page), payouts and invoices are for Accounting view only.
- Grouping customers by merchant uses the merchant they bought from most; the merchant filter
  keeps everyone who bought from that merchant. Governorate is a grouping only (names do not
  fit the list address); the old ?governorate= filter link opens the whole list.
- A customer's notes, reminders and history need the customer data switch even for settings
  managers; reminders are labelled CUS-xxxxxx so a push notice never shows a name.
- The customers list loads the 5,000 highest spenders (the list limit); search and filters run
  over those.
- The product page shows stock only in the reader's stores; there is no product delete or
  merge (unchanged).

## UX phase C step 4 (Sales and HR): built (branch claude/ux-phase-c, not deployed)

Phase C is done: every app now uses the Odoo style list views and document pages. Sales: the
deals list next to the board (search by DEAL number, company, contact, phone or email; stage,
mine, not assigned, follow up overdue, no next step, stuck, source, proposal and day filters;
owner and day values; grouped by stage, owner, source, month; fee totals; bulk Give to (sales
manage), Move to stage and Mark lost), companies and proposals lists, and the deal and company
pages in the document frame with smart buttons and the chatter. HR: the employee list (file
flags, status, employment, pay basis; department and below, position, grade and store), leave
requests (opens on waiting; waiting for me; bulk Approve and Refuse), violations and suggested
violations (bulk Confirm and Dismiss) as list views, and the employee, leave request and
violation pages in the frame. No migration. CLAUDE.md has the decision line "UX phase C step 4
(Sales and HR)". Choices the owner should confirm:

- The deal's chatter (notes and Remind me) is new and separate from the deal's activities: the
  activities stay the "next step" feature (timeline, My day, the overdue alert) on the page as
  before; the chatter is for internal notes and personal reminders. The history moved into the
  chatter.
- Bulk Mark lost uses the reason "other" with the note typed in the list (a reason from the list
  needs the deal page). Bulk Move to stage offers only open stages; won is decided on the deal.
- Bulk Approve of leave approves the step each request waits for: the manager step only when the
  person approving is the manager in force (as from the inbox), the HR step with HR use. Bulk
  Refuse refuses at either step, as HR could already one by one.
- Bulk Confirm of suggestions uses each suggestion's type; confirming one with another type is
  still offered below the list.
- "Follow up overdue" means the next step is past due by more than sales.overdue_minutes (the
  same rule as the alert); "stuck" is sales.stale_days in the stage.
- The violations list shows the fixed EGP amount of a deduction only (never a deduction in days
  of pay, which comes from the salary); national IDs are searchable only with HR use.
- Suggested violations open the person's file (there is no suggestion page).
