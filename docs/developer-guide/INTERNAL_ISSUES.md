# Internal issues found while documenting the Accounting screens

Not part of the PDF. Collected from the screen chapters (30 to 34), merged and deduplicated.
Each item names the chapter and screen where it was seen.

## Wording and labels

1. **Bill state "open" reads "Waiting for answer".** Chapter 31 (Supplier bills: list pill and status bar) and chapter 34 (Statuses and their colors). The label `workflow.states.open` is shared with tickets; on a bill it should read Open or Unpaid.
2. **Wrong message when paying too much tax.** Chapter 34 (Taxes, Taxes owed). Paying refused with `more_than_owed` shows "That is more than the rider has earned." The key `finance.merchants.errors.more_than_owed` is worded for rider withdrawals and is reused by every finance form. Seen paying 10 EGP of VAT while VAT is a credit.
3. **Doubled unit in a label.** Chapter 31 (Money movements): the amount field reads "Amount (EGP) (EGP)".
4. **Approval request kind `loan_in` has no translation.** Chapter 32 (Loans, the request in Approvals): the heading shows `finance.approvals.kinds.loan_in` and Type shows `loan_in`.
5. **Raw status word on a smart button.** Chapter 31 (Petty cash page): the request smart button shows "rejected" / "pending" untranslated.
6. **Raw method value.** Chapter 31 (Rider withdrawal page, paid): "Paid by way of" shows `store_cash` instead of words.
7. **Purchase order decided by a second person.** Chapter 31 (Purchase order page): when rejected, the line "Approved by" shows the person who rejected (should read Decided by); when closed, the close note is shown after "Approved by".
8. **Two settings without a name.** Chapter 34 (Accounting settings): `finance.corporate_tax_bp` (Salaries and tax) and `finance.payout_minimum_piastres` (Money controls) show their raw key as the title; no entry under `admin.settings.names`.
9. **Wallet group 1350 has no name in the drill reports.** Chapter 33 (Balance sheet): shows "1350: 2 wallets" because `finance.reports.groups` has no `g1350` (Rider dues); Compare periods names it correctly.
10. **Journal CSV button label.** Chapter 33 (Journal list): "Export to Excel · every line (CSV)" mixes two formats in one label.
11. **Menu label and page title differ.** Chapter 33: the menu says "Profit per store", the page title "Profit by store".

## History (audit) display

12. **History shows untranslated action keys and raw piastres.** Chapter 33 (approval request page: `finance.request_create`, `finance.request_approve`, `finance.request_reject`, "amount: – → 1350000"), chapter 34 (journal entry of a tax payment: `finance.tax_payment`, "amount: – → 1000" for 10.00 EGP) and chapter 32 (Basata deposit page: `basata_deposit.submit`, `basata_deposit.approve`, amounts in piastres).

## Journal entry page and approvals

13. **"Posted for" shows a raw key.** Chapter 33 (journal entry page): on an entry posted through an approval, the Posted for field, its tile and the printed voucher show the request kind (`journal`, `expense`...) in lower case instead of words or the request number. Cause: `sourceOf()` in `packages/db/src/finance/documents.ts` returns `request.kind`. It also duplicates the Approval tile.
14. **The Arabic voucher PDF prints the type in English.** Chapter 33: `/finance/journal/<id>/voucher.pdf?lang=ar` shows "Journal entry"; the page builds the `kind` label with `getTranslations({ locale: 'ar' })`, which appears to return the current (English) messages. The Arabic footer also shows a double separator "شيبلي ناو - - JV-…".
15. **The approval request page does not show the lines.** Chapter 33: the second person sees amount, reference and receipts but not which accounts will be debited and credited before approving.
16. **Approve and Reject shown to Accounting use.** Chapter 33: the request card appears for anyone with Accounting use, but `POST /finance/requests/:id/decide` needs Accounting manage, so a use level person gets a refusal after clicking.
17. **After approval the request page takes the entry's number.** Chapter 33: breadcrumbs read "Approvals / JV-002577" and the title JV-002577 instead of the request number.
18. **Accrual reversals have no link to the accrual.** Chapter 33: `accrual_reversal` entries store `data.accrualId` but the entry page shows no Posted for tile or field; only the memo "Reversal: …" connects them.
19. **Prepared on of an approved entry is the approval moment.** Chapter 33: on JV-002577, Prepared on and Approved at are both 23:13 while the request was asked at 23:11; the entry's History also names the asker as the actor at 23:13.

## Dates and layout

20. **Compare periods uses browser date boxes.** Chapter 33 (Compare periods, `/finance/statements`): `type="date"` fields (mm/dd/yyyy in an English browser) instead of the house DateInput; column headers and the balance sheet title show ISO days. The cash flow forecast's Week column also shows ISO days.
21. **Labels beside date boxes.** Chapter 34 (Year end and export: "From01/01/2026" with no space), chapter 32 (Record Basata transfer: Day it arrived; Loans: First instalment): the label sits beside the box instead of above it, unlike other forms.
22. **Month end: two totals and two date formats.** Chapter 34: the checklist counts 10 items ("8 of 10 done") while the guided run counts 9 ("8 of 9 done") for the same month; the checklist writes the closed day as YYYY-MM-DD while the run uses dd/mm/yyyy.
23. **Close the books typed date.** Chapter 34: the date box limits only the calendar to yesterday; a typed later day is sent and refused by the API ("You can close only days that are over."). A check in the form would avoid the round trip.

## Behaviour

24. **Salary run offers a month already paid.** Chapter 31 (Salaries and payslips): the October 2026 run was already paid (payslips exist), yet the run section still offers "Pay salaries for 2026-10" without saying it was paid; repeating it only returns the first run.
25. **No button to reopen a bank line.** Chapter 32 (Bank matching): matched and set aside lines disappear from the list; the API has `POST /finance/bank-lines/:id/reopen` but no button calls it.
26. **Success message never seen.** Chapter 34 (Chart of accounts, Open a new account): the form closes on success and its message "Account n opened." goes with it.
27. **Search with no result shows nothing.** Chapter 34 (Chart of accounts): a search matching nothing leaves an empty page with no "nothing found" line.
28. **Merchant profit what if differs from booked at current prices.** Chapter 33 (Merchant profit): with the contract's own prices the What if shows order fees 1,746.12 against 1,746.31 booked (0.19 EGP difference: rounding per order against the booked sum, or tiers).
29. **Use as budget lists rows that would not change.** Chapter 33 (Forecast): the replace preview lists all 143 existing rows even when Budget now equals This scenario, hiding the few that change.
