# Merging Shiply Core into Shiply Now

One platform, two services, two companies under one group.

1. **Shiply Now**: 60 minute delivery from dark stores (stock, picking, riders).
2. **Shiply** (the parcel network, built as Shiply Core in `shiply-core/`): next day parcels.
   Merchant warehouse, pickup to the nearest sorting facility, truck routes between facilities,
   last mile hub, customer.

This repository (Shiply Now) is the base. Core moves in module by module. While it moves, Core
keeps running from `shiply-core/` with its own tests, so nothing is ever half broken. When every
module has moved and its tests pass here, `shiply-core/` is deleted.

## Decisions (owner, 2026-11-07)

1. Shiply Now is not live with real merchants, so the database is rebuilt from migrations and
   seeds; no data is copied.
2. The same merchants use both services: one merchant record, one login.
3. Two companies under one group, different teams. Every ledger line carries its company and its
   cost center. The P&L is shown combined, per company or per cost center. Work one company does
   for the other is charged between them and removed in the combined P&L.
4. Riders (Shiply Now, paid per delivery) and couriers (Shiply, working through agents) stay two
   separate teams with one shared login. (Default; the owner can change it.)
5. Company names default to "Shiply Now" and "Shiply", editable in settings.

## Shared: taken from Shiply Now

| Core table | Becomes | Notes |
|---|---|---|
| User | User | New roles: hub_staff, courier, agent. Courier details move to a Courier table beside Rider. Hub team moves to a HubMember table. |
| Merchant | Merchant | Adds code, pickup address, governorate and area, pickup facility, price tier discount, FlexShip, logo, sign up status. merchantOwner maps to merchantRole. |
| Governorate | Governorate | Shiply Now's table (Int id, code). Adds the pricing zone and the hub that serves it (null means not served). |
| Setting | Setting | Core keys move to the `parcels.` namespace in packages/shared settings. |
| AuditLog | AuditLog | Same meaning. |
| Alert | Alert | Adds hubId and agentId; Core alert kinds become types. |
| Account, JournalEntry, JournalLine | LedgerAccount, LedgerEntry, LedgerLine | Core's posting helper becomes an adapter onto Shiply Now's ledger. Party lines become per party ledger accounts, as Shiply Now does for merchants and riders. |
| Supplier, Bill, Budget, TaxInvoice | same names | Shiply Now's are fuller (fixed assets, prepayments, cheques). Core's bank import becomes BankStatement. |
| Payout | Payout | Merchant payouts for both services in one run. |
| OtpCode, Message | kept | Message becomes CustomerMessage beside Shiply Now's EmailOutbox. |
| ShopifyStore, ShopifyOrder | ShopifyShop, ShopOrder | Shiply Now already syncs shops and orders. "Ship with Shiply" picks from ShopOrder; a ShopOrderParcel link records the AWB. ShopifyTask becomes ShopifyOutbox items. |
| PurchaseOrder, PurchaseOrderLine | same names | One purchasing flow for dark store packaging and for packaging sold to merchants. |
| PackagingProduct, StockMove | PackagingItem, PackagingMovement | Items gain "sold to merchants" with a price; the merchant shop sells from them. |

## Renamed: same name, different meaning

| Core table | Becomes | Why |
|---|---|---|
| Zone | PricingZone | Shiply Now's Zone is a delivery polygon of a dark store. |
| Shift | CourierShift | Shiply Now's Shift is an HR work shift. |
| Area | NetworkArea | Later joined to Shiply Now's GeoArea map polygons for coverage. |

## Added as is (only in Core)

Hub, LineHaulLink, Agent, AgentDocument, CourierArea, Vehicle, VehicleRequest, Shipment,
ShipmentEvent, Pickup, RecurringPickup, Bag, Pallet, Trip, Run, RunItem, CourierEarning,
Withdrawal, PayIn, SafeDeposit, AgentSettlement, AgentAdvance, Expense, JournalDraft, QcTicket,
PriceTier, MerchantPrice, CourierPing, PackagingOrder, PackagingOrderLine, ApiKey,
ApiIdempotency, Webhook, WebhookDelivery, SandboxParcel.

Their ids switch to Shiply Now's style (cuid).

## New for the group

1. **Company**: Shiply Now, Shiply. CompanyProfile becomes one row per company (tax number,
   ETA settings).
2. **CostCenter**: each dark store, each sorting facility and hub, each head office team.
3. **LedgerLine** gains companyId and costCenterId. Every posting states both.

## Order of work

1. Done: Shiply Now brought into this branch; both run side by side.
2. Done: Core tables in Shiply Now's schema (migrations 20270101000000_parcels_network and
   20270101000100_companies_cost_centers); companies and cost centers.
3. Done: Core's API is apps/api/src/parcels, served under /parcels (RouterModule). Sign in is
   Shiply Now's (one login, email or Egyptian mobile); ParcelsGuard maps roles for the network
   routes. The 69 network tests run in apps/api/test/parcels against Shiply Now's test database.
   Payouts, expenses, journals, closing the books and full reports are Shiply Now's Accounting
   for both companies; the network keeps courier wallets, pay ins, hub safes, agent settlements
   and advances, and shows the combined trial balance and balance sheet.
4. Done in part: Core screens are apps/web/src/app/parcels (network code in src/parcels). Hub
   staff, couriers and agents land on /parcels/hub, /parcels/courier and /parcels/agent;
   admins and finance open the Parcel network tile on /home. Still to do: one shared shell and
   menus, and the merchant area showing both services.
5. Done in part: network postings go to the shared ledger as company shiply, each line on the
   cost center of its hub (named hub, else the courier's hub, else the merchant's facility).
   Still to do: P&L views per company and cost center in Accounting.
6. Shopify: one app, two actions (60 minutes, next day).
7. Connect the operations: orders out of 60 minute range become next day parcels; stock moves
   between dark stores through the sorting network.
8. Merge Core's packaging shop with Shiply Now's packaging and purchase orders; one alerts list.
9. Delete `shiply-core/`.
