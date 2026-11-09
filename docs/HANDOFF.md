# Handoff: where work stopped (2026-11-07, 22:00 UTC)

**Update 2026-11-09:** the owner chose Shiply Now only. The merge was undone on ShiplyNow (the
merged version is kept on `claude/shiply-merge-archive`) and the live database was refilled with
the demo month. Phase B continues from the WIP below.

The owner paused work to merge the Shiply core system. This note says exactly what is live,
what was in progress and what comes next, so the work can resume without guessing.

## Live on Render (branch ShiplyNow, head 74323ff, all tests and CI green)

- Public website (Home, How it works, For brands, Contact; Our team hidden until people are sent)
- Sales app: leads, pipeline, deals, follow ups, proposals with public accept link, win to merchant,
  targets, dashboard, commission (monthly fees target, 2 active months, 5% if hit)
- HR: phase 3 (leave, violations, inbox, self service), phase 1 (HR home, list, file tabs, setup
  pages), phase 2 (hire and leaving wizards, documents)
- Merchant contracts v2 (versions, every price, tiers, payment terms, promises, PDF, merchant page
  tabs) and contract pricing (shipping fee per shipment, per product prices, all inclusive preset,
  failed = 100% of the shipment charges)
- Rider pay: per delivery only, no salary, wallet with a 5 working day hold, withdrawal requests
- Accounting UX phase A (Odoo style): list views, document pages with chatter, dashboard cards,
  menus by job, reports page, Taxes as one page, one search, bulk approve

## In progress: Accounting UX phase B (not merged, not pushed)

- Work so far is a WIP commit f383ef9 on the local branch `worktree-agent-a334bcb078a4c211e`
  (worktree .claude/worktrees/agent-a334bcb078a4c211e), based on 74323ff. About half done; it
  stopped while building the Pay merchants run component.
- Scope (approved by the owner): drill down reports (P&L, balance sheet, trial balance: account →
  lines → entry; period presets, comparison, store and merchant filters, PDF and Excel export),
  an Odoo style bank matching screen (suggestions, one click and multi line match, bank charge,
  set aside, keyboard), a "Pay merchants" guided run (prepare due, review, bulk approve, CIB file,
  mark paid with one reference), a "Close the month" guided run (checklist with fix buttons, then
  close the books), a "Record an expense" quick form, dashboard and menu links to them.
- The local branch lives only in this container. If the container is gone, rebuild phase B from
  the scope above on top of ShiplyNow.

## Next after phase B (agreed)

- Accounting UX phase C: the same Odoo style list views and document pages in the other apps
  (Operations, Inventory, Merchants, Sales, HR).

## Waiting on the owner

- Proposal PDF: yes or no
- Our team page: people, roles, achievements, photos
- Render settings: VAPID keys (phone notifications), SMTP (merchant emails)
- Nightly backup workflow on main: approval
- HR person or lawyer to check leave and penalty defaults
- Nabta's real contract prices (Merchants > Nabta > Contract > Edit, all inclusive preset)
- Several "choices to confirm" listed in CLAUDE.md decision lines (rider pay, contracts, pricing)

## Note on branches

All Shiply Now work is on the `ShiplyNow` branch. `main` still holds the old Java project
(legacy). Merging the Shiply core system should be planned against `ShiplyNow` (or main updated
from ShiplyNow first), and Render deploys `ShiplyNow`.
