# Accounting Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The money module, phase 1: the ledger for both companies, one cash model for every cash holder with two sided handovers, merchant wallets with fees and VAT, payouts, bills and expenses with second person approval, and profit and loss.

**Architecture:** Module `money` with its own schema. It is the only module that books money. Other modules announce what happened (`cash.collected`, `fee.charged` and so on, written to the outbox) and money books it, or call `MoneyService` from `money/index.ts`. Balances come from the ledger, never from stored totals.

**Tech Stack:** as before.

**Spec:** `shiply/docs/UI.md` Step 3c (Accounting app, its rules and phases), `shiply/docs/TECH.md` sections 3 to 5. Owner decisions (2026-11-09, defaults the owner accepted with "go", each a setting): the old system's chart and codes; VAT 14% on our fees from day one; a second person approves every payout and bill, any amount.

## Global Constraints

- Everything in the earlier plans' constraints still applies.
- Double entry: every entry balances (debits = credits, both in piastres), never edited or deleted; a correction is a reversing entry. A request with the same `sourceKey` is booked once.
- Every entry states its company (`shiply_now` or `shiply`) and every line its cost centre when it has one; party lines carry `partyType` (`merchant`, `holder`, `supplier`) and `partyId`.
- Cash moves only by a handover between two cash holders: the giver states the amount, the receiver confirms what was actually received; a difference books to 5301 Cash shortages and surpluses against the giver and raises an attention item.
- VAT rate is the setting `money.vat_rate_bp` (default 1400); fee lines and VAT lines are separate.
- Payouts and bills: draft → approved (a second person with `accounting` manage, never the preparer) → paid. Payouts never exceed the merchant's available balance at approval.
- Access: `accounting` view to see, use to prepare, manage to approve.

## Review Focus

1. A handover confirmed twice, or confirmed by the giver: refused.
2. Two payouts for one merchant approved at once that together exceed the balance: one is refused.
3. A fee booked twice by an event delivered twice: one entry (sourceKey).
4. Amounts with Arabic digits or commas in the forms: read correctly or refused with the field named.
5. Profit and loss for one company never shows the other company's lines.

---

### Task 1: Chart, ledger and posting

**Files:** schema `money` in `packages/db/prisma/schema.prisma`, seed of the chart in `packages/db/src/seed.ts`; `apps/api/src/money/{index.ts, money.module.ts, ledger.service.ts}`; test `apps/api/test/ledger.test.ts`

**Interfaces:**
- Models: `Account(code @id, nameEn, nameAr, type: asset|liability|equity|income|expense, active)`; `JournalEntry(id, companyKey, date, memo, sourceType, sourceId, sourceKey unique, createdById?, reversesId?)`; `JournalLine(id, entryId, accountCode, debit Int, credit Int, costCentreId?, partyType?, partyId?)`.
- Seed: the old chart (1101 CIB, 1151, 1401, 1402, 1601, 1701, 2301 VAT payable, 2302, 2303, 2304, 2305, 2306, 2401, 2451, 3101, 3201, 3301, 3401, 4101 Delivery and service fees, 4201, 4301 to 4306, 5101, 5151 to 5156, 5201, 5301, 5401 to 5409, 5501, 5601, 5701, 5702, 5801, 5901, 5902) plus 1201 Cash with riders and couriers, 1202 Store cash boxes, 1203 Hub safes, 1204 Cash with agents, 1301 Merchant receivables, 2101 Merchant payables (COD owed), 2201 Supplier and agent payables.
- `LedgerService.post(tx, {companyKey, date, memo, sourceType, sourceId, sourceKey, lines}) → entryId | null` (null when `sourceKey` already booked); throws `unbalanced` when debits ≠ credits or a line has both or neither; `reverse(tx, entryId, userId)`; `balance({accountCode?, partyType?, partyId?, companyKey?, to?})`; `trialBalance(companyKey?)`; `profitAndLoss({companyKey?, costCentreId?, from, to})`.

- [ ] Tests: unbalanced entry refused; same sourceKey twice → one entry; reversal brings the balance back to zero; trial balance always sums to zero; P&L for `shiply` excludes `shiply_now` lines.
- [ ] RED → implement → GREEN → commit `feat(money): chart, ledger and posting`.

### Task 2: Cash holders and handovers

**Files:** `apps/api/src/money/{cash.service.ts, cash.controller.ts}`; test `apps/api/test/cash.test.ts`

**Interfaces:**
- Models: `CashHolder(id, kind: rider|courier|store_box|hub_safe|agent|bank, refId?, nameEn, nameAr, companyKey, accountCode (1201|1202|1203|1204|1101), costCentreId?, active)`; `Handover(id, fromHolderId, toHolderId, amount, confirmedAmount?, status: pending|confirmed|disputed, createdById, confirmedById?, createdAt, confirmedAt?)`.
- Events handled: `cash.collected {companyKey, holderId, merchantId, amount, sourceType, sourceId}` → Dr holder account (party holder) / Cr 2101 (party merchant).
- Routes: `GET/POST/PATCH /money/holders`; `GET /money/holders/:id` (balance from the ledger, its handovers); `POST /money/handovers {fromHolderId, toHolderId, amount}` (accounting use, or later the field apps); `POST /money/handovers/:id/confirm {receivedAmount}` (not by its creator; once); booking: Dr receiver / Cr giver for the received amount; a shortage books Dr 5301 (party giver) / Cr giver for the difference and raises attention `money.handoverShort`.
- Public: `MoneyService.holderFor(kind, refId)` creates on first use.

- [ ] Tests: confirm by the creator → 403; confirm twice → 409; 1,000 handed, 950 received → receiver +950, giver 0, 5301 holds 50 against the giver, attention shown; `cash.collected` delivered twice → booked once.
- [ ] RED → implement → GREEN → commit `feat(money): cash holders and handovers`.

### Task 3: Merchant wallets, fees and VAT

**Files:** `apps/api/src/money/wallets.service.ts`, `wallets.controller.ts`; test `apps/api/test/wallets.test.ts`

**Interfaces:**
- Events handled: `fee.charged {companyKey, merchantId, kind: delivery|cod|return|open_package|storage|receiving|packaging|other, amount, costCentreId?, sourceType, sourceId}` → Dr 2101 (party merchant) / Cr the fee's income account (4101 for Shiply Now kinds, 4301 to 4305 for parcel kinds) and Cr 2301 VAT at `money.vat_rate_bp` on top (the merchant is charged fee plus VAT).
- `GET /money/wallets?q&page` (merchant, collected, fees, VAT, paid out, available); `GET /money/wallets/:merchantId/statement?from&to` (dated lines with running balance) and as CSV.
- Public: `MoneyService.walletBalance(merchantId)`.

- [ ] Tests: COD 500 EGP collected then a 40 EGP delivery fee → available 500 − 40 − 5.60 = 454.40; statement lines sum to the balance; a fee event delivered twice → one fee.
- [ ] RED → implement → GREEN → commit `feat(money): merchant wallets, fees and VAT`.

### Task 4: Payouts, bills and expenses

**Files:** `apps/api/src/money/{payouts.*, bills.*, expenses.*}`; test `apps/api/test/payouts.test.ts`

**Interfaces:**
- Models: `Payout(id, merchantId, companyKey, amount, status: draft|approved|paid|cancelled, method: bank|cash, reference?, preparedById, approvedById?, paidById?, dates)`; `Bill(id, companyKey, payee, supplierRef?, number, date, dueDate, amount, vat, accountCode, costCentreId?, status: draft|approved|paid|cancelled, preparedById, approvedById?, paidFromHolderId?)`; `Expense(id, companyKey, date, accountCode, amount, vat, costCentreId?, paidFromHolderId, note, createdById)`.
- Payouts: `POST /money/payouts {merchantId, amount}` (≤ available); `POST /:id/approve` (accounting manage, not the preparer; re-checks available inside a transaction that locks the merchant's wallet row; books Dr 2101 / Cr 1101 on paid, not on approval); `POST /:id/paid {reference}`; `POST /:id/cancel` (draft or approved only).
- Bills: create, approve (manage, not preparer; books Dr expense + Dr VAT input as 1401 for now / Cr 2201), pay (from a holder: Dr 2201 / Cr holder).
- Expenses: create (books at once Dr account + VAT / Cr holder; account must be an expense account).
- Home: attention `money.approvalsWaiting` (payouts and bills waiting) for accounting manage.

- [ ] Tests: preparer approving → 403; two payouts of 300 on a 454.40 balance approved at once → one 200, one 409 `over_balance`; paid payout lowers available; bill approve then pay books 2201 to zero; expense into an income account → 400.
- [ ] RED → implement → GREEN → commit `feat(money): payouts, bills and expenses`.

### Task 5: Accounting app screens

**Files:** `apps/web/src/app/[locale]/(shell)/accounting/...`, `apps/web/e2e/accounting.spec.ts`, texts.

- Menu (UI.md Step 3c, phase 1 pages): `Cash▾ (Holders, Handovers)  Wallets  Payouts  Bills  Expenses  Ledger▾ (Journal, Trial balance, Profit and loss)`; Invoices & tax, Banks and Budgets show "Phase 2". A company switch (Shiply Now | Shiply | Both) on every money page.
- Amount inputs accept Arabic digits and commas (normalised before `toPiastres`) and name the bad field.

- [ ] Playwright: create a hub safe and a courier holder, hand over 1,000, the receiver confirms 950 → the shortage shows on the courier and on Home; a merchant wallet shows its statement; prepare a payout, the preparer has no Approve, a second admin approves and marks it paid; P&L for Shiply shows only Shiply lines.
- [ ] RED → implement → GREEN; full suite and lint → commit `feat(money): accounting app` and push.

---

**Done when:** the Accounting tile opens the phase 1 pages; handovers, wallets, payouts, bills, expenses and the ledger work end to end with second person approval; all tests pass.

**Not in this plan (phase 2):** e-invoicing to the tax authority, bank statement import and matching, cheques, budgets, fixed assets, year end.
