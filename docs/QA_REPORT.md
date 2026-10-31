# QA report: Shiply Now

Date: 2026-10-28. Branch: ShiplyNow. Run with gstack /qa (test, fix, verify).

## Summary

QA found 4 issues and fixed all 4, each with a regression test. Nothing is deferred.

| Check | Result |
| --- | --- |
| Native test suite (unit, database, API) | 329 tests pass (shared 49, web 24, database 154, API 102) |
| Every API route called by every role and by nobody (181 routes × 6 = 1,086 calls) | 0 server errors after fixes (4 before). No route answers without sign in except `/health` and `/coverage/areas`, which are public by design. Every route refuses the wrong role. |
| Every web page for every role, phone and desktop, English and Arabic (about 300 page views) | No crash, no server error, no sideways scrolling on phone. Raw text codes on one page (fixed). |
| Money: concurrency, idempotency, dates, amounts, CSV safety, books balance | 17 of 17 pass after fixes (16 of 17 before) |
| Operations refusals: orders, store access, rider access, sign in lockout, sign up, photos | 15 of 15 pass after fixes (14 of 15 before) |
| Lint, format, typecheck | Clean |

## Issues

| # | Severity | Where | What was wrong | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| ISSUE-001 | High | Finance, merchant statement | A statement (or its CSV) for a merchant id that does not exist crashed with a server error (500) instead of saying "not found". It also raised a false server error alert for admin. | Fixed and verified: answers 404 `merchant_not_found`. | 7b1eb00 |
| ISSUE-002 | Medium | Every date input (money forms, payouts, filters, balance sheet) | An impossible day such as 30 February was accepted and silently booked as 2 March. | Fixed and verified: one shared check (`isCalendarDay`) is used by every form, filter and posting; such days are refused. | 7b1eb00 |
| ISSUE-003 | Medium | Admin, audit log | The audit log showed technical codes (`finance.expense`, `refill.plan`) for every action, and raw names for 12 kinds of records, in both languages. | Fixed and verified: every action and record has an English and Arabic name; the browser recheck finds no codes left. | 68845f5 |
| ISSUE-004 | Medium | Proof photos (pack and delivery) | Any bytes were accepted as a proof photo if the upload said "image/jpeg", so a text file or script could be stored as proof. | Fixed and verified: the upload must start with the real JPEG, PNG or WebP signature of the declared type. | ae5056b |

Regression tests: `packages/shared/src/hours.test.ts` (real calendar days), `apps/api/test/finance.regression-1.test.ts` (ISSUE-001 and ISSUE-002 at the API), `apps/api/test/photos.regression-1.test.ts` (ISSUE-004). Each failed before its fix and passes after.

## What was tested, by role

**Everyone.** Sign in, wrong password lockout (6 tries lock the account for 15 minutes, even with the right password), sign out, Help and SOP page, English and Arabic, light and dark preference.

**Merchant.** Orders: in a zone, outside every zone (refused), store closed or full (refused with the reason), zero quantity, no items, unknown product, missing name, negative fee, unknown payment method (all refused without a server error). Products, shipments, returns, wallet, statement CSV, notifications and onboarding pages.

**Store staff.** Orders queue, pick, pack with photo, hand to rider, receive, put away, counts, damaged, returns, transfers and cash pages. A staff member of one store cannot open another store's orders. Proof photos: real JPEG, PNG and WebP accepted; text, an image of another type and script content refused; files above the size limit refused.

**Rider.** Deliveries page. A rider cannot complete a delivery that is not theirs.

**Finance.** Chart of accounts (automatic codes: CIB 1101, next bank 1102), opening and closing accounts, transfers, expenses with VAT, owner money, other income, journal entries, statements and CSV, trial balance, profit and loss, balance sheet. Two transfers sent at the same moment can never take more than the account holds. The same request sent twice at the same moment is booked once. Amounts that are negative, zero, fractions, text or above the limit are refused. Formulas typed into names, references or notes are neutralised in CSV exports. After every probe the trial balance and the balance sheet still balance.

**Admin.** Every admin page in both languages and both widths, users, settings, audit, stores, zones, address map, Shopify, transfers and refill.

The full journeys (merchant order to delivered with cash, failed delivery and retry, payouts, returns, damage, transfers through the hub, refill) are covered by the native test suite, which runs them with a controlled clock.

## Not tested here, and why

- **Map tiles on the zones page** did not load in the test machine because its network blocks OpenStreetMap; this is the test environment, not the app. Check once on the live site.
- **Real Shopify, Google Maps and OpenStreetMap import** were not called from the test machine (no outbound access); they are covered by the simulated Shopify and geocoder in the test suite. Check live after deploy.
- **Phone camera scanning** needs a real phone and https; check on the live site with a store phone.
- The gstack evidence recorder was not used; probes were run with repository scripts and their outputs are kept with the local report under `.gstack/qa-reports/` (not committed).

## Gaps raised by the business during this round (features, not bugs)

These are not defects in what exists; they are what the business asked for next, in this order:

1. Cancel and back buttons everywhere, saved and unsaved states, and a status timeline on every document (draft, waiting, done), like Odoo.
2. Internal tickets and messages connected to Slack: ask a team member from the system, they get a Slack message and answer in Slack, the ticket updates, with reminders when the answer is late or unread.
3. Deeper SOPs: daily routine, numbered steps, how to check a step went right, and who tells whom.
4. Shopify data collection: full product, order, sales and stock history per merchant, for merchant and market insights.
5. Address finding is weak until the OpenStreetMap import is run on the live server (Admin, Address map).
