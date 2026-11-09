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
