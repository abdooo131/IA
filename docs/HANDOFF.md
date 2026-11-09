# Handoff: where work stands (2026-11-09)

## Live on Render (branch ShiplyNow)

Shiply Now only. The merge with the Shiply parcel network was undone at the owner's request on
2026-11-09; the merged version is kept on the branch `claude/shiply-merge-archive` and its data in
the Neon backup `backup-before-shiplynow-only-2026-11-09`.

- Public website (Home, How it works, For brands, Contact; Our team hidden until people are sent)
- Operations, Inventory, Merchants, Customers, Sales, HR, Accounting (phase A) and Settings
- Merchant contracts v2 with contract pricing, rider pay per delivery with the wallet
- Database: `shiplynow_live` (the only database on the server), filled with the demo month.
  The service setting DATABASE_NAME points the app at it; deploy/prepare.mjs loads the starting
  data and the demo month alone before the servers start (512 MB instance).

## Next: Accounting UX phase B (approved by the owner)

Drill down reports (P&L, balance sheet, trial balance: account → lines → entry; period presets,
comparison, store and merchant filters, PDF and Excel export), an Odoo style bank matching screen
(suggestions, one click and multi line match, bank charge, set aside, keyboard), a "Pay merchants"
guided run (prepare due, review, bulk approve, CIB file, mark paid with one reference), a "Close
the month" guided run (checklist with fix buttons, then close the books), a "Record an expense"
quick form, dashboard and menu links to them. An unfinished start (commit f383ef9) exists only in
one development container; if it is gone, build phase B from this scope.

After phase B: phase C, the same list views and document pages in the other apps.

## Waiting on the owner

- Proposal PDF: yes or no
- Our team page: people, roles, achievements, photos
- Render settings: VAPID keys (phone notifications), SMTP (merchant emails)
- Nightly backup workflow on main: approval
- HR person or lawyer to check leave and penalty defaults
- Real merchants and their contract prices (the live data is demo data)
- Several "choices to confirm" listed in CLAUDE.md decision lines (rider pay, contracts, pricing)
