# Handoff: where work stands (2026-11-09)

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

## Next: UX phase C step 2

The same list views and document pages in Inventory (stock, shipments, transfers, returns,
counts), then Merchants, Customers, HR and Sales.

## Waiting on the owner

- Proposal PDF: yes or no
- Our team page: people, roles, achievements, photos
- Render settings: VAPID keys (phone notifications), SMTP (merchant emails)
- Nightly backup workflow on main: approval
- HR person or lawyer to check leave and penalty defaults
- Real merchants and their contract prices (the live data is demo data)
- Several "choices to confirm" listed in CLAUDE.md decision lines (rider pay, contracts, pricing)
