# Merchant portal (locked)

The merchant's own panel. Owner's spec, with the owner's decisions:

1. Shiply Now (60 minute delivery) is added beside next day parcels.
2. Insurance is kept.
3. International and drop off points are removed everywhere.
4. Everything else in the owner's spec is kept as written.

Rules: our own brand system (no colours, fonts or style from any reference), Arabic and English
with RTL, mock data behind an API layer ready for the real backend. Built after the Location and
Merchants apps.

## Global shell

Sidebar (collapsible): insurance status badge, Home, Orders, Packaging, Pickups, Wallet, Credits,
section MORE: Applications, Inventory, Products, Analytics, Capital.

Top bar:
1. Split button **Create** with: Create Domestic Order (Cmd+O), Create 60 Minute Order,
   Create Multiple Orders (Cmd+M), Schedule Pickup (Cmd+P).
2. **View Services** opens the Services Hub.
3. Bell with unread count: order needs action with the reason (Wrong Phone Number, Product
   Issue) and "View Orders Now", rate your pickup, FlexShip payment status, low stock in a dark
   store.
4. Help opens Support Tickets. Settings icon opens Settings. Store avatar.

Floating support chat button.

## 1. Home

Greeting, store logo, "Last updated at" with refresh. Today's summary toggle: Domestic | 60 minutes
| Inventory. KPI cards with info tooltip, each opens the filtered orders list: In Progress,
Heading to Customer, Completed Orders (x / total), Awaiting Action, Heading to you, New, Expected
Cash (EGP), Collected Cash (EGP with % badge). Services block with View all: Store with us,
Insurance, FlexShip. Right column: promo carousel (install app, add payout card) and Suggestion box
with "Suggest now".

## 2. Orders list

Header: Print New Orders, Create Order ▾ (Domestic, 60 minutes, Multiple).
Service tabs: **Domestic | 60 minutes**.

Domestic status tabs: All, New, In progress, Unclear Addresses (new badge), Heading to customer,
Returns On Way, Awaiting your action, Successful, Unsuccessful, Rejected Returns, Printed, Not
Printed.
60 minutes status tabs: All, New, Accepted, Picking, Packed, Out for delivery, Delivered, Failed,
Cancelled, Moved to next day (stock missing or zone closed).

Toolbar: Show count, search with field selector (Order ID, Phone Number, Order Reference, Smart
Sticker), Filters, Export (emails a download link).

Filters (each a dropdown with Cancel / Apply, scrollable with arrows, clear X): Order Type
(Deliver, Cash Collection, Exchange, Return, Sign & Return, Pick & Choose), Package Type, Current
Status grouped: NEW (New, Pending pickup), PROCESSING (Picked up, Fulfilled, In progress, Heading to
customer, Returns On Way, Heading to you), PAUSED (Awaiting your action, Rejected Return),
SUCCESSFUL (Successful), UNSUCCESSFUL (Returned, Unsuccessful, Archived, Terminated); Updated At,
Confirmed At (date ranges), Customer Name, Customer City, Customer Phone, Order ID, Order
Reference, Marketplace Orders, FlexShip. 60 minutes adds: Dark store.

Columns: checkbox, Order ID (link), Type and size, Customer (name, phone), Location (city, area),
Collection Amount (amount and Cash on delivery / Paid online / No Cash Collection), FlexShip Fees
(amount and payment state), Status, Attempts (x/3), Payment Status (In Progress / Unpaid / Paid),
Estimated delivery date (date and "Maximum" date), Created At, Last update. 50 per page.

Selection: top bar "x Selected", Print AWB, Delete; floating bulk bar: count, Select All, Request
Deposit, Print Selected Orders, More (Download, Create Support Ticket, Delete).

## 3. Order details (/orders/:id)

Header: type and ID, status tag, call status tag (No Response), created date and by whom. Buttons:
Order Summary (modal, "Got it"), ... (Get Help, Cancel), Edit, Print Airwaybill.

Tab Order Details: attempt banner (x/3 and failure reason), explanation box, expected delivery
date. Operation details: WhatsApp contact status and "Show Conversation", customer reply status,
attempts, expected delivery time, customer rating (stars), customer comment. Consignee: name,
success rate hint, phone, address, building, floor, apartment, landmark. Shipment: type and size,
items count, description, product image, return location, order reference, delivery notes. Right
column: internal Order Notes (not printed), Collection Amount, Open package allowed, FlexShip
amount, Product Value and Upload proof, fees (Shipping, Open package, VAT 14%, total estimate),
wallet note. 60 minutes orders add: dark store, items picked, rider.

Tab Order Tracking: stepper (Created, Received, In progress, Heading to consignee, Delivered; for
60 minutes: Accepted, Picking, Packed, Out for delivery, Delivered), timeline with time and hub,
communication panel tabs: WhatsApp Conversation, Calls, SMS Messages.

## 4. Create order (full page)

Top: close X, "Confirm and Create Another", "Create Order".
Type: Deliver, Pick & Choose (NEW), Exchange, Return, Cash Collection, 60 minutes.

Customer details (all types): Phone Number, + Add Secondary Phone Number, Full Name, Detailed
Address, Governorate and Area (searchable, filled by the address finder as the merchant types),
+ Add Additional Details (Building Name or Number, Floor, Apartment, Landmark, optional), Work
Address checkbox.

Footer (all types): Estimated Fees (live, expandable), Pay with Credits, Return Package Location,
Order Reference, Delivery Notes, Order Notes (not printed on the AWB).

1. **Deliver**: Package Info (Select from products toggle, size Small, Medium, Large, Light Bulky,
   Heavy Bulky and a Prohibited Package link, Description, Items Count, Product Photo up to 10MB).
   Right: Collection Amount, Request Deposit from Customer, Allow customer to open package (EGP 7
   fee), Item Value and Upload proof, Insurance box.
2. **Pick & Choose**: products from the catalog only (max 3 products, one flyer, Select Products,
   View all); Collection Amount, Shipping Fee (added to collection), Request Deposit, Open package
   (forced on, product image hint), Apply FlexShip and amount, Item Value, Insurance.
3. **Exchange**: tracking number of the order to return and Apply (fills the data); Package Info
   (new item) and Return Package Info (description, count, photo); Collect cash or Refund cash;
   Request Deposit; Open package; Item Value; Insurance.
4. **Return**: tracking number and Apply; Return Package Info; Refund cash; Item Value; Insurance.
5. **Cash Collection**: customer only; Collect cash or Give cash; no package, no return location.
6. **60 minutes**: products from the catalog with stock in the dark store that serves the
   customer's area (shown as the merchant picks the area); Collection Amount; no package size.
   Outside the store's zone or out of stock: offered as next day instead.

## 5. Bulk upload (Smart Upload)

Type: Deliver, Exchange, Return, Cash Collection. Download template, drag and drop .xlsx (up to 500
orders), Upload File, then a review step with every row checked (missing fields, unclear address
with the suggested area, phone format).

## 6. Pickups

Sub tabs: Upcoming Pickups | History Pickups. Count, search by pickup ID, Filters, Export. Empty
state with Schedule Pickup. Schedule New Pickup modal: Number of Parcels (fee warning), Prohibited
items link, Location, Date, Contact Person, Repeat Pickup (SAT to THU and end date), fragile items,
big items, Notes, submit. Cancel asks "Are you sure? All entered data will be lost" (Back /
Confirm).

## 7. Packaging (shop)

Tabs: Shop | Track. Need Help, Watch Video, How it works. Categories: All, Flyers, Boxes, Stickers,
Other. Product cards: name, size, price, pack size, quantity stepper, max per order. Cart button
"Confirm Order (EGP total)". Track lists packaging orders.

## 8. Wallet

Tabs: Total Balance | Cash Cycles. Need Help. Balance card (View Breakdown, Recharge Balance), Cash
out Frequency card (Learn more, Change Plan), Next Cash Out Date with status. Transactions tabs:
All, Recharge, Cash outs, Cash Collection, Compensations, Deductions, Others; date range, Export.
Columns: plus or minus, Transaction ID, Date, Category and description, Amount, Balance, Actions
(View Breakdown, Export File, View Receipt). Cash Cycles: search, cycles linking to their orders,
View Breakdown, Export. Covers both services.

## 9. Credits

Explanation, current balance, Recharge Credits, transactions with date range and Export, empty
state.

## 10. Applications

Tabs All | Installed, Need Help, Suggest a new App. Cards with Install / Installed / Manage / Know
More: Shopify, WooCommerce, EasyOrders, Chrome Extension, Request a Deposit, Brand Manager (multi
store).

## 11. Inventory (Shiply Now stock, real, not a landing page)

Stock per dark store per product: on hand, reserved, available. Send stock to a store (inbound
manifest: products, quantities, store, date), its status (sent, received, put away, differences).
Low stock alerts and thresholds. Stock movements history. First visit with no stock: the benefits
page and "Activate the service".

## 12. Products

Add product ▾ (Add Single Product, Import Multiple Products from Excel). Tabs: All, Active,
Inactive, Low stock. Search by name, ID, tags. Columns: checkbox, image and name, variants count,
Collection Amount, Location, Availability (Out of stock / Low stock / quantity), Ordered, Active
toggle. Row menu: Edit, Duplicate, Create Order, Delete. One catalog for both services, matched to
Shopify by SKU.

## 13. Analytics

Tabs: Domestic, 60 minutes, Stock. Period (This month), filters Cities, Order Type. Widgets:
Total, Successful, Unsuccessful Orders, Cash Collected; Unsuccessful Delivery Reasons; Delivery
Success Rate donut; Delivery Attempts (1st, 2nd, 3rd); Average Delivery Time; Geographical
Analysis (city, success rate, completed); Cash outs with View Receipt; Cash Cycles chart (Collected
Cash, Fees, Net Profit) with View Breakdown. 60 minutes adds: share delivered within 60 minutes.

## 14. Capital (financing)

Eligibility banner, Apply for Financing, Watch how it works, criteria with progress (orders per
month, monthly sales, consecutive months, success rate), FAQ.

## 15. Services Hub

Delivery: FlexShip, Pick & Choose, 60 minute delivery. Finances: Capital. Management: Store your
products, Shipment Insurance, Account Manager.

## 16. Support tickets

Create New Ticket, tabs Requests | Compensations | FAQs, list with count, filter by team member,
status (Open, Pending Response), pagination, conversation panel. Tickets land in the CS and QC app.

## 17. Settings

View Prohibited Items. Tabs:
1. Control Panel: Dashboard Preferences (Language AR or EN, printer email and Save, Auto print
   AWBs); Shipping Preferences (Open package: Ask Every Time / Always Reject / Always Allow;
   FlexShip fee amount, Edit, auto enable; WhatsApp confirmation); AWB Preferences (label size,
   product display, description example, live AWB preview).
2. Personal Info (name, phone, email, Edit).
3. Business Information (logo, names EN and AR, sales channels, industry, website, business ID,
   Save; Sub Accounts).
4. Security (2FA app, Request Password Change, Delete Account).
5. Pricing Plan (rates by zone and order type, both services).
6. Payout Methods (cash out frequency, bank account, Change Plan).
7. Subscriptions Billing.
8. Team Members (Add New, name, job title, email, permission, status).
9. API Integration (API key with Request OTP).

## Order lifecycle

Statuses as in the filter. 3 delivery attempts, then return to origin. Fees from zone, size, type,
open package, FlexShip and VAT 14%. Cash cycles move collected COD into the wallet; payouts on
schedule. Every status change logs a timeline event and sends WhatsApp or SMS to the customer.
