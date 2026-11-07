# How a parcel moves

## The network

1. **Sorting facilities** (Obour `OBR`, Alexandria `ALXSF`): every merchant parcel goes first to
   the facility **nearest the merchant**, which the system picks by map distance. Each facility
   has three teams, each with its own station:
   1. **Inbound team**: scans in everything that arrives (pickups, drop offs, line haul bags,
      returns). The screen says where each parcel goes next.
   2. **Sorting team**: scans each parcel inbound handed over; the system names its lane (its last
      mile hub, or another facility), or the return shelf.
   3. **Outbound team**: scans each parcel from its lane into the bag for its next place. That scan
      is the handover from sorting. Then seals the bag, loads it on the truck and marks the truck
      as leaving.

Every handover is a parcel scan, so a missing order is caught where it went missing: a bag that
arrives is opened by scanning it, then every parcel in it is scanned in; closing the bag marks any
parcel that was not scanned as lost, with the bag code and place. The **Handover check** screen
shows what waits between each pair of teams and flags anything waiting longer than the
`handover.alert_hours` setting (4 hours by default). A lost parcel scanned anywhere is found again.
2. **Last mile hubs** (Nasr City, Maadi, Dokki, Tanta, Assiut fed by Obour; Smouha and Damanhour fed
   by Alexandria): each is fed by its nearest facility. They receive bags, run couriers to the end
   consumer, and bag returns back to their facility. No teams there.

Which last mile hub delivers to an address: the area's hub if the area has one, otherwise the
governorate's hub. A governorate with no hub is not served yet and parcels to it are refused.

## System routing

At every scan the system works out the next place:

1. At the parcel's last mile hub → deliver.
2. At a last mile hub that is not its target → send to that hub's sorting facility.
3. At a facility that feeds the target hub → bag for that hub.
4. At a facility that does not → bag for the facility that does (line haul between facilities).
5. Returns target the merchant's facility; once there, sorting puts them on the return shelf and a
   first mile courier hands them back.

## The day

| When (default) | What happens | Who | Screen |
| --- | --- | --- | --- |
| Until 18:00 | Create parcels, print labels, ask for a pickup | Merchant | Merchant: New parcel, Pickups |
| Afternoon | Assign the pickup to a first mile courier | Facility supervisor | Operations: Pickups |
| Afternoon | Scan every label at the merchant; promised date is set | First mile courier | Courier: Pickups |
| Evening | Scan everything in | Inbound team | Operations: Inbound |
| Evening | Scan each parcel; put it on the lane the screen shows | Sorting team | Operations: Sorting |
| Night | Scan each parcel from its lane into its bag, seal, load trucks, dispatch | Outbound team | Operations: Outbound |
| Night | Facility to facility line haul goes through the other facility's three teams the same way | Other facility | Operations |
| Early morning | Receive bags | Last mile hub staff | Operations: Receive |
| Morning | Load courier runs, send couriers out | Last mile hub staff | Operations: Courier runs |
| Day | Deliver and collect the exact cash, or record why not | Last mile courier | Courier: My run |
| Evening | Scan failed parcels back, count cash, close the run; bag returns to the facility | Last mile hub staff | Operations: Receive, Courier runs, Send back, Trips |
| Weekly | Pay merchants: cash collected minus fees | Admin | Admin: Money |

The promised date is set when the parcel enters the network (pickup scan or drop off): today plus
the zone's transit days, plus one day when it enters after the cutoff, skipping Friday.

## Agents and attendance

Pickup and delivery staff come from agents. Operations register each agent with their papers
(national ID, commercial register, tax card, contract), bank account and commission (the default
is in Settings). Every agent gets a code. Couriers register at `/join` with that code and wait;
the agent approves them by choosing their hub (pickup staff at a sorting facility, delivery staff at
a last mile hub), shift start, work days, areas, and for pickup staff a vehicle and whether they
also drive hub to hub.

Every working day each active courier has a shift. They check in from the courier app with a photo
(and the location when the phone allows). 30 minutes after the shift starts with no check in, the
agent gets an alert and answers: late (with the expected time) or not coming. After "not coming"
the agent has 60 minutes to send a replacement from their free staff; if not, operations get an
urgent alert. Both times are settings. Operations see every agent's attendance at
`/admin/attendance` and every open alert at `/admin/alerts`.

Operations can ask an agent for a vehicle with a driver (special merchant pickup, breakdown, full
vehicle) at an agreed price. The agent answers with the driver and vehicle; operations close it
when the job is done.

## Money

Every money movement is a double entry in the books (`journal_entries`, `journal_lines`), which
cannot be edited and must balance. Wallets are balances on shared accounts, one per party:

| Account | What it holds |
| --- | --- |
| 1000 Bank | Money in the company bank |
| 1100 Hub safes | Cash each hub received from couriers, until it is deposited |
| 1200 Cash with couriers | Cash a courier collected and has not handed in |
| 2100 Merchant balances | What we owe each merchant: cash collected minus fees |
| 2200 Courier wallets | What each courier earned, minus shortages and penalties |
| 2300 Owed to agents | Month end settlements not yet paid |
| 4000 to 4900 | Shipping, COD fee, return fee, cash out fee and other income |
| 5000 to 5290 | Courier pay, agent commission, vehicles, rent and other expenses |

What posts, and when:

1. **Delivered**: the courier holds the cash; the merchant is owed it less shipping and COD fee;
   the courier earns delivery points.
2. **Returned to the merchant**: shipping and the return fee (60% of shipping) are charged; the
   courier earns return points.
3. **Pickup received at the facility**: the pickup courier earns points for each parcel.
4. **Run closed at the hub**: cash moves from the courier to the hub safe. Cash already paid in
   through Fawry for that run is not expected. A shortage comes out of the courier's wallet. A
   courier who reaches the daily target earns the daily bonus.
5. **Fawry pay in**: the courier uploads the receipt; finance confirms the money arrived. It lowers
   the cash they owe, or recharges a negative wallet.
6. **Negative wallet**: the courier is frozen and cannot be given a run until they recharge, or
   finance lets them work for up to 72 hours with a written reason.
7. **Withdrawal**: couriers paid by the company withdraw earnings older than 3 days, approved by
   finance. Delivery staff of an agent (and pickup staff, if the setting says agents pay them) are
   paid through their agent instead.
8. **Merchant payout**: on the merchant's payout days, everything whose cash is in a hub safe goes
   into a payout. A second person approves it, the bank file goes to CIB, then it is marked paid.
   A change of bank account also needs a second person.
9. **Agent month end**: staff earnings for the month, commission on work (15% by default), fixed
   vehicle rent and special vehicles, minus penalties for late replacements. A second person
   approves; the agent uploads an invoice; then it is paid.
10. **Hub safe deposit**, **expenses** and **manual journals** (opening balances) are confirmed by a
    second person before they post.
11. **Closing the books** for a day stops anything being posted on or before it.

12. **VAT**: our prices include 14% VAT. Every fee books its amount before VAT as revenue and the
    VAT on account 2400. Supplier bills book the VAT we paid on account 1500. The Taxes page shows
    the month's VAT to pay and records the payment.
13. **Tax invoices**: after a month ends, finance issues one tax invoice per merchant (numbered
    once, never twice). A credit note gives money back against an invoice, after a second person
    approves. Each document downloads as the Egyptian Tax Authority's file; sending it directly
    needs the company's ETA client id, secret and signing token.
14. **Suppliers and bills**: a bill records the amount before VAT, the VAT and the withholding tax
    (0, 1, 3 or 5%). A second person approves it, then it is paid by its due date. Withholding tax
    is paid to the state from the Taxes page.
15. **Bank matching**: the bank's CSV statement is imported and each line matched to our books by
    amount and date (a shared reference breaks a tie); lines only the bank has (charges, interest)
    are booked from there.
16. **Agent advances**: an agent may take up to half of what they earned so far this month (a
    setting), approved by finance; it comes off their month end payment.
17. **Cash limits**: a courier holding more cash than allowed, or a hub safe holding too much,
    raises an urgent alert until it is handed in or deposited.

Reports: trial balance, profit and loss, balance sheet, cash flow, profit per merchant, hub and
courier, budgets against actual, and the age of money held.

## Statuses

| Status | Meaning | Where it is |
| --- | --- | --- |
| Created | Merchant made it, waiting for pickup | At the merchant |
| Picked up | First mile courier scanned it | In the courier's vehicle |
| At inbound | Inbound team scanned it in | Sorting facility, inbound area |
| Sorted, on lane | Sorting team put it on the lane for its next place | Sorting facility, waiting for outbound |
| In outbound bag | Outbound team scanned it into a bag | Sorting facility (or last mile hub), waiting for a truck |
| In transit | In a bag on a truck | On the road |
| At hub | Ready for a courier run | Last mile hub, or the facility's return shelf |
| On hold | Failed attempt, waiting for the merchant | Last mile hub |
| Out for delivery | With a courier, to the consumer or back to the merchant | With the courier |
| Attempt failed | Courier could not deliver; still with the courier | With the courier |
| Delivered / Returned / Cancelled | Done | |
| Lost | Admin marked it lost; a scan anywhere marks it found | Unknown |

## When delivery fails

1. No answer, not available, postponed, cannot pay, other: tried again the next day.
2. Wrong address, wrong phone, refused: on hold. The merchant sends it again (and can fix the
   details) or asks for it back.
3. After 3 failed attempts it turns into a return automatically.

## Money

Shipping by zone and size minus the merchant discount; COD fee 1% above 3,000 EGP on delivered
parcels; return fee 50% of shipping. Couriers collect the exact amount; the hub counts the cash at
run close; differences are recorded against the courier. A merchant's parcels become payable once
the run that delivered or returned them is closed.
