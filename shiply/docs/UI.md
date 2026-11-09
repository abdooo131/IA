# Shiply UI decisions

Agreed with the owner one step at a time. A step written here is locked: it is not reopened
unless the owner asks.

## Step 1: who uses the system and where they land (locked)

| Who | Device | Lands on |
| --- | --- | --- |
| Office team (admin, operations, finance, HR, sales) | Desktop | Home |
| CS and QC team | Desktop, phone at the hub | CS and QC queue |
| Hub staff (inbound, sorting, outbound) | Phone or tablet | Their hub station |
| Dark store staff (receive, pick, pack) | Phone | Their store queue |
| Couriers (Shiply parcels) | Phone | Today's runs |
| Riders (Shiply Now, 60 minutes) | Phone | Assigned orders |
| Agents (courier companies) | Desktop or phone | Their couriers and money |
| Merchants | Desktop | Their dashboard for both services |
| Customers | Phone | Public tracking page and location confirmation link |

## Step 1b: Home page (locked)

1. Top bar on every page: logo, one search box (parcel or order number, phone, merchant),
   Arabic and English switch, bell, the user's name.
2. Needs your attention: what waits for this user, most urgent first, one click each.
   Empty state: "Nothing waiting for you".
3. Today in numbers: 4 to 6 clickable numbers for the user's role.
4. App tiles: only the ones the user can open, each with a count when something inside needs
   action.

Left out on purpose: recently opened (search does it), charts (Reports), announcements (bell).

## Step 1c: the 12 app tiles (locked)

| Tile | Inside |
| --- | --- |
| Shiply Now | 60 minute orders, dark stores, stock, picking, riders, returns |
| Shiply | Parcels, pickups, hubs (inbound, sorting, outbound), couriers, agents |
| Merchants | One merchant list for both services: contracts and prices, Shopify links, sign ups, packaging they order |
| CS and QC | Customer tickets, calls and WhatsApp, rescheduling, damaged, lost and wrong item cases, delivery photo checks, disputes, courier and rider audits |
| Location | Addresses that need a location, the address finder, areas and map (zones, hubs, stores), taught names |
| Fleet | Vehicles, vehicle requests, trucks and routes between hubs |
| Purchasing | Suppliers, purchase orders, packaging stock |
| Accounting | Cash and wallets, payouts, bills, taxes and invoices, ledger |
| HR | Employees, shifts, attendance, payroll, documents |
| Sales | Leads, follow ups, proposals, new merchant deals |
| Reports | Every number and chart across the business |
| Settings | Users and access, integrations, general settings |

## Step 2: inside every app (locked)

Every one of the 12 apps follows the same pattern.

1. **Top menu beside the logo**, not a side bar: `SHIPLY › App name` then the app's pages in one
   row. More than 7 pages: the rest go under **More ▾**. Related pages share a dropdown
   (Hubs ▾: Inbound, Sorting, Outbound). Second row: search, Arabic and English switch, bell,
   **⊞ Apps** (the 12 tiles from any page), the user's name. Phone: ☰ opens the same menu.
   Why: the pages are mostly wide tables, and the top menu gives them the full width.
2. **List page**: title and the main button (for example "New pickup"); search and filters
   (status, date, area, merchant, clear); the table (click a row to open it, tick rows for bulk
   actions, export to Excel); pages of 50. Phone: the table becomes cards.
3. **Record page**: header with the number, the status and the main actions (for example
   "Assign courier", "Mark lost", More ▾); tabs (details, items, money, documents); a timeline
   on the side of every event, who and when. Phone: the timeline moves under the details.
4. Every action that cannot be undone asks for confirmation, and every action shows a clear
   success or error message.

## Notes for the Shiply app (agreed, to be placed when we reach it)

1. Sorting facilities and last mile hubs are both inside the Shiply app, not separate modules:
   one parcel passes through both, and the handover is one recorded scan on both sides.
2. Menu: `Parcels  Pickups  Sorting facilities▾  Last mile hubs▾  Couriers  Agents  More▾`.
   Sorting facilities ▾: Inbound, Sorting, Outbound, stock of parcels.
   Last mile hubs ▾: Receive, Sort, Dispatch, Returns, Cash handover.
3. Staff land on their own station for their own facility or hub.
4. Last mile hub flow: Receive (scan against the truck list, missing parcels flagged) → Sort by
   delivery zone (the scan shows the zone and shelf in big letters, the zone comes from the
   address) → Dispatch (the screen suggests the courier who covers the zone, the supervisor
   confirms, the courier scans parcels into the run; each parcel is then assigned to that
   courier) → End of day (returns scanned back, courier hands in cash).
5. Every hub's ground is split into delivery zones: small groups of neighbourhoods. Each
   courier has the zones they usually cover in their profile.
6. The map chain: area → delivery zone → last mile hub → sorting facility. One map decides the
   whole route.

## Step 3a: Location app (locked)

Menu: `Needs location  Address finder  Map  Places  Taught names`

1. **Needs location**: addresses placed without confidence, from both services. Each shows the
   system's best guesses and Pick area, Send customer link (WhatsApp or SMS), Call. Oldest first,
   with a timer.
2. **Address finder**: one address or a whole file (the address lab tester).
3. **Map**: each area shows its delivery zone → last mile hub → sorting facility, and its dark
   store for Shiply Now. Click to change any of them or mark it not served. Every change is
   recorded.
4. **Places**: governorates, districts, neighbourhoods, compounds, streets and landmarks with
   their spellings. Add, edit, merge.
5. **Taught names**: who taught which word and when, with remove.

Access: CS and QC work Needs location. Operations managers edit Map and Places.

## Step 3b: Merchants app, office side (locked)

Menu: `Merchants  Sign ups  Contracts  Shopify stores  Packaging orders`

1. **Merchants**: one list for both services: services used (Shiply Now, Shiply, both), status,
   COD balance, account manager.
2. **Sign ups**: new merchants waiting for approval with their documents; approve or reject.
3. **Contracts**: prices for both services, start and end, discounts. A price change needs a
   second person to approve.
4. **Shopify stores**: connected shops and their sync health.
5. **Packaging orders**: packaging merchants buy from us, and its delivery.

Merchant record: header (name, status, services, Suspend, New contract, Message). Tabs: Overview,
Shiply Now (stores, SKUs, stock), Shiply (pickup address, pickup facility, recurring pickups),
Contract and prices, Money (statement, COD, fees, payouts), Users, Integrations, Documents.
Timeline on the side.

The merchant's own panel: see MERCHANT_PORTAL.md.

## Step 3c: Accounting app (locked)

Both companies (Shiply Now, Shiply). Every money screen has a company switch: Shiply Now |
Shiply | Both.

Menu: `Cash▾  Payouts  Bills  Expenses  Invoices & tax  Banks  Ledger▾  Budgets`

1. **Cash ▾**: one cash model for every cash holder (rider, courier, store box, hub safe,
   agent): same rule, same screens. Shows where every pound of COD is and who holds it.
2. **Payouts**: merchant payouts for both services in one run: prepare, check, approve (second
   person), pay, receipt.
3. **Bills**: supplier and agent bills with due dates; an agent bill needs the agent's invoice
   before it is paid.
4. **Expenses**: daily spending with receipts.
5. **Invoices & tax**: tax invoices to merchants, e-invoicing to the tax authority, VAT.
6. **Banks**: accounts, statement import, matching.
7. **Ledger ▾**: journal, trial balance, profit and loss, balance sheet; per company, per cost
   centre (each store, hub, team) or combined.
8. **Budgets**: monthly budget against actual per cost centre.

Rules:
1. Cash moves only by a recorded two sided handover (rider to store box, courier to hub safe).
   The receiver confirms the amount; a difference opens a ticket at once.
2. Each thing lives in one app: payroll in HR (Accounting sees only the booked total),
   contracts in Merchants, purchase orders in Purchasing.
3. Kept from the old system as rules: append only double entry ledger in piastres, the same
   request booked once, no overdraw under concurrent transfers, trial balance always balances,
   two companies with cost centres, e-invoicing.

Phases:
1. Phase 1 (to go live): Cash, Payouts, Bills, Expenses, Ledger with profit and loss.
2. Phase 2 (after launch): Invoices & tax, Banks, cheques, Budgets, fixed assets, year end.

Old system review: 44 pages in 7 menus, about 18,000 lines. Cash was handled twice (rider
wallets and store boxes in Shiply Now, courier wallets and hub safes in the parcels code), and
payroll, contracts and purchase orders sat in Accounting as well as their own apps.

## Step 3d: Shiply app, next day parcels (locked)

Menu: `Overview  Parcels  Pickups  Sorting facilities▾  Last mile hubs▾  Couriers▾  Agents  More▾`

1. **Overview**: today's flow from pickup to delivered, parcels past their deadline, failure rate
   per hub.
2. **Parcels**: every parcel; filters status, hub, merchant, courier, date; record with timeline.
3. **Pickups**: scheduled, assigned, done; recurring pickups.
4. **Sorting facilities ▾**: Inbound, Sorting, Outbound, the facility's parcels.
5. **Last mile hubs ▾**: Receive, Sort by zone, Dispatch, Returns, Cash handover (flow in the
   notes above).
6. **Couriers ▾**: live map, list with their zones, shifts, earnings.
7. **Agents**: courier companies and their couriers.
8. **More ▾**: alerts, failed attempts (reason, attempt number, next try).

Moved out (each lives in one app only): QC tickets, lost parcels and merchant claims → CS and QC;
network map → Location; price tiers → Merchants contracts; vehicle requests → Fleet; field
accounts → Settings and HR.

Internal statuses (kept from the old system): Created, Picked up, At inbound, Sorted, At outbound,
In transit, At hub, On hold, Out for delivery, Attempt failed, Delivered, Returned, Cancelled,
Lost. The merchant sees the grouped statuses of the merchant portal, mapped automatically from
these.

## Step 3e: Shiply Now app, 60 minute delivery (locked)

Menu: `Overview  Orders  Dark stores▾  Stock▾  Riders▾  Returns  More▾`

1. **Overview**: live orders per store with their 60 minute timers, late orders, stores near
   capacity or closed.
2. **Orders**: filters status, store, merchant, date; record timeline with the time of each step.
3. **Dark stores ▾**: list (hours, capacity, open or closed) and each store's floor: Receive,
   Put away, Pick, Pack, Hand to rider.
4. **Stock ▾**: levels per store and bin, inbound from merchants, transfers between stores,
   counts, movements history.
5. **Riders ▾**: live map, list, shifts, earnings per delivery.
6. **Returns**: failed and returned orders: back to stock or back to the merchant.
7. **More ▾**: alerts, store settings (SLA minutes, capacity), values in settings, never in code.

Statuses: New, Accepted, Picking, Packed, Out for delivery, Delivered; Failed, Cancelled, Moved to
next day (stock missing or zone closed: the order passes to Shiply automatically).

Moved out: zones and addresses → Location; packaging → Purchasing; damage cases → CS and QC.
Store staff land on their store's floor; riders on their phone screen.

## Step 3f: CS and QC app (locked)

Menu: `Inbox  Tickets  Cases▾  Calls & WhatsApp  Audits  More▾`

1. **Inbox**: everything waiting, oldest first, deadline timer: new tickets, customer replies,
   failed deliveries needing a call, addresses needing a location.
2. **Tickets**: from merchants (portal), customers (calls, WhatsApp), staff; type, priority,
   owner, deadline, conversation.
3. **Cases ▾**: damaged, lost, wrong item, delivery disputes, compensation claims; linked to the
   parcel or order, photos and cash. Compensation is paid by Accounting after a second person
   approves.
4. **Calls & WhatsApp**: the customer conversation for any parcel or order, with templates
   (reschedule, confirm address, failed delivery reason).
5. **Audits**: delivery photo checks, random checks on couriers and riders, fake failed attempt
   detection (for example "not answering" with no call logged).
6. **More ▾**: reasons, templates, deadlines per ticket type.

Rule: every problem is a ticket or a case with one owner and one deadline; nothing closes without
a written outcome.

## Step 3g: Agents & Fleet app (locked)

Every driver, courier, rider and pickup person is outsourced through agents, for both companies.

Menu: `Agents  People  Vehicles  Requests  Truck routes  Compliance`

1. **Agents**: each agent company, contract and rates (per delivery, pickup, trip), services it
   works for, performance.
2. **People**: every courier, rider and driver: agent, role (delivery, pickup, rider, truck
   driver), documents, zones, approval status. One person, one record, one login.
3. **Vehicles**: the agents' vehicles: plate, type, capacity, assigned person.
4. **Requests**: hubs and stores ask for extra people or vehicles for a day; the agent confirms.
5. **Truck routes**: fixed routes between facilities and hubs, departure times, trip scans.
6. **Compliance**: expired licences, insurance and documents; people blocked until fixed.

No maintenance (the agent's job).

Changes to apps locked earlier:
1. Shiply: "Agents" leaves its menu; Couriers ▾ keeps only live map, shifts, earnings.
2. Shiply Now: Riders ▾ keeps only live map, shifts, earnings.
3. Accounting: each agent is paid by one agent settlement per period for both companies, minus
   the cash its people hold; it becomes a bill once the agent's invoice arrives.
4. HR: couriers and riders are not employees and are not in HR.

## Step 3h: Purchasing app (locked)

Stock driven. Material warehouses exist only inside the sorting facilities.

Menu: `Overview  Stock  Consumption  Suggestions  Purchase orders  Receiving  Transfers  Suppliers  Items`

1. **Overview**: items below their reorder point, days of cover per item, late POs.
2. **Stock**: per material warehouse (one per sorting facility): on hand, on order, reserved for
   transfers.
3. **Consumption**: usage recorded automatically where possible (a flyer and an AWB label per
   packed order, transfers out, packaging sold to merchants), per day and week, with the trend.
4. **Suggestions**: per item and warehouse: forecast (recent average daily use weighted to the
   latest weeks, with trend); reorder point (use during the supplier's lead time plus safety
   stock days); recommended PO quantity (cover lead time and the period to the next order plus
   safety stock, minus on hand and on order, rounded up to pack size and minimum order). Each
   shows why in one line. The buyer adjusts and approves; it becomes a PO.
5. **Purchase orders**: draft, approved (second person above a set amount), sent, partly
   received, received.
6. **Receiving**: count against the PO; differences flagged; the supplier bill goes to
   Accounting.
7. **Transfers**: material from a sorting facility warehouse to a dark store or hub. Material
   sent to a dark store is expensed at once as operating cost on that store's cost centre (dark
   stores do not sell it and keep no material stock). Transfers count in the forecast.
8. **Suppliers**: prices, lead time, minimum order, pack sizes, on time rate.
9. **Items**: unit, pack size, safety days, preferred supplier.

Packaging sold to merchants is issued from the sorting facility warehouse and counts in
consumption.

## Step 3i: HR app (locked)

Own staff only: office, sorting facility and hub staff, dark store staff. Couriers and riders
belong to agents (Agents & Fleet).

Menu: `Overview  Employees  Attendance▾  Leave  Violations  Payroll  Inbox  More▾`

1. **Overview**: headcount per site, hiring, contracts and documents expiring, today's absences.
2. **Employees**: file (Arabic and English names, national ID and expiry, contract, probation,
   social insurance, salary bank account, job, site and cost centre, login), documents with
   expiry alerts 30 days before, timeline of everything.
3. **Attendance ▾**: today's board (in, late, missing), roster per site, days. Clock in and out
   from the phone within 150 m of the site (a setting); manual punch needs a reason; forgotten
   clock out closes at shift end and is flagged.
4. **Leave**: Egyptian law defaults as settings HR confirms (annual 21, 30 after 10 years or age
   50; casual 6 inside annual; sick with a doctor's note; unpaid); manager approves, HR overrides.
5. **Violations**: penalty rules escalating 1st, 2nd, 3rd time; lateness and absence raise them
   automatically; the employee can reply; only confirmed deductions reach payroll; legal limits
   are settings.
6. **Payroll**: monthly run: prepare, check, second person approves, payslips; the total books to
   Accounting. Payroll lives only here.
7. **Inbox**: requests and approvals waiting for HR.
8. **More ▾**: new hire checklist, leavers checklist, documents expiring, org chart, settings
   (shifts, leave types, penalty rules, document types).

Every employee has **My HR** from their name menu: own file, attendance, leave balance and
requests, violations (read only, with reply).

Moved out: QC checklists and scores → CS and QC (HR only receives the violation); account
managers → Merchants.

## Step 3j: Sales app (locked)

Menu: `My day  Pipeline  Leads  Companies  Proposals  Onboarding  Accounts  Targets  More▾`

1. **My day**: today's calls, meetings, follow ups, overdue.
2. **Pipeline**: board by stage (New, Contacted, Meeting, Proposal, Negotiation, Won, Lost) and list.
3. **Leads**: website form, sign ups, referrals; new leads wait in the managers' queue to be given
   to a rep.
4. **Companies**: brands and contacts, expected orders a month, Shopify domain.
5. **Proposals**: prices for both services, public link the merchant opens and accepts; a
   discount beyond the limit needs a manager.
6. **Onboarding**: after Won, a checklist per merchant until the first 10 orders (Shopify
   connected, prices confirmed, first pickup scheduled, packaging ordered, first order
   delivered), each step with owner and date; stuck more than 7 days alerts the account manager.
7. **Accounts**: existing merchants' weekly orders, success rate, complaints; a sharp drop (for
   example 40% under their usual week, a setting) gives the account manager a call task.
8. **Targets**: per rep per month, results dashboard, commission.
9. **More ▾**: lost reasons, settings.

Quick quote: a button on every company and deal: expected orders a month, main areas, sizes →
price estimate → proposal.

Rules: reps see only their own deals, managers see all (kept from the old system). Won creates
the merchant and their contract in Merchants automatically from the accepted proposal.
