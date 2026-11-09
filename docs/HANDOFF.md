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

## Next: Accounting UX phase C

The same list views and document pages in the other apps (Operations, Inventory, Merchants,
Customers, HR, Sales), reusing the phase A building blocks.

## Waiting on the owner

- Proposal PDF: yes or no
- Our team page: people, roles, achievements, photos
- Render settings: VAPID keys (phone notifications), SMTP (merchant emails)
- Nightly backup workflow on main: approval
- HR person or lawyer to check leave and penalty defaults
- Real merchants and their contract prices (the live data is demo data)
- Several "choices to confirm" listed in CLAUDE.md decision lines (rider pay, contracts, pricing)
