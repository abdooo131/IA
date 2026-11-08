# Full business cycle: test scenarios A to Z

The whole business after the merge (owner, 2026-11-08): Shiply Now (60 minute delivery from dark
stores) and Shiply (next day parcels through hubs) run their own operations; Sales, Merchants,
Accounting, HR and Settings are shared. Each scenario names who does it, where, and what must be
true afterwards. Run them in order on a database with the seed and the demo data.

## A. Sales wins a merchant for both services

1. Sales rep: Sales > Leads. A website lead (Contact form) appears as a new deal.
2. Sales manager assigns it to a rep; the rep logs a call and a next step.
3. Rep makes a proposal: 60 minute shipping fee and prices by delivery zone, next day prices by
   route zone and size, COD fee, failed delivery share, monthly minimum, deposit.
4. A discount above the limit waits for a sales manager who did not make it.
5. Rep sends it; the public link shows our company, the prices in plain words, an example month.
6. The merchant accepts with name and title. The rep confirms: a merchant, its owner user, a
   contract version with every price, the rep as account manager, the deal won. A one time
   setup link is shown.
7. Must hold: the merchant appears once in Merchants for both services; the contract shows the
   zone prices and the parcel prices; nobody but Sales can add a merchant.

## B. The merchant's first day

1. The owner opens the setup link, chooses a password and signs in.
2. Home shows the onboarding checklist and both services.
3. Adds products (one by one and CSV), sets the 60 minute price, sees the contract and its PDF.
4. Adds their team member with limited rights; the member sees only allowed menus.
5. Sets the payout bank account and schedule.

## C. Stock into a dark store (Shiply Now)

1. Merchant creates an inbound shipment (ASN) with products and quantities.
2. Hub or store staff receive by scan, including an extra unit and one not on the ASN.
3. Put away to shelves; the merchant sees received against expected.
4. Admin moves stock hub to store with a transfer: approve, pick, send, receive, put away.
5. Must hold: stock on hand per store is right; receiving fees are booked.

## D. A 60 minute order, delivered

1. Merchant creates an order by area or map pin (or it comes from Shopify).
2. The store accepts, picks by scan, packs with a photo, hands to a rider by badge scan.
3. The rider delivers with the customer's code and collects cash.
4. The rider hands the cash to the store; staff count it.
5. Must hold: the order page shows the timeline, the fees from the contract (zone price),
   COD credited, the payout cycle; stock went down; the rider earned pay per delivery.

## E. A 60 minute order that fails, then the other endings

1. The rider fails with "no answer" (two calls and a door photo needed).
2. Staff receive the goods back; the merchant decides: try again, ship normally or cancel.
3. A second attempt delivers. A failed delivery fee was charged once per attempt.
4. Merchant cancels a new order (stock released). Admin cancels a packed order.
5. A return of sellable units to the merchant; a damage report and its settlement.

## F. A next day parcel, delivered

1. Next day merchant creates a parcel (single and bulk upload) with item value.
2. Pickup is planned; the courier picks it up; the hub scans it at inbound, sorting, outbound.
3. It travels by line haul to the last mile hub; a courier takes it out and delivers it with COD.
4. The courier closes the run; cash goes to the hub safe.
5. Must hold: the parcel page shows the same layout as a 60 minute order, the route, the fees
   from the route zone price, the payout cycle.

## G. Next day exceptions

1. A failed attempt puts the parcel on hold; the merchant fixes the phone and tries again, or
   asks for it back (return fee).
2. A parcel with no scan is searched for on its own, then confirmed lost and compensated.
3. A merchant claims damage on a delivered parcel; it is approved or rejected.

## H. Money for both companies

1. Accounting dashboard shows what waits today.
2. Merchant wallets show both services; one payout pays both; it needs a second person above
   the limit; it is marked paid with a reference; the merchant sees it and the statement.
3. Rider and courier wallets: withdrawals asked, approved, paid.
4. Agents' monthly settlement is a supplier bill paid in Accounting.
5. Month end: tax invoices per merchant, VAT, the checklist, closing the books.
6. Must hold: every ledger line carries its company and cost center; the trial balance
   balances; profit per store and per hub make sense.

## I. People

1. HR hires a store staff member and a courier (wizard, documents, login link).
2. Clock in by location, a leave request approved by the manager then HR.
3. The salary run for employees; riders and couriers are paid per delivery, never on payroll.

## J. Every role sees the right things

1. Each account in the demo list signs in and lands on its home.
2. Tiles and menus show only what the person can open; no menu leads to a not found page.
3. Every page works in Arabic (right to left) and English, on a phone width too.
