# How a parcel moves

## The network

1. **Merchant hub** (for example Nasr City, `CAI-E`): picks parcels up from merchants near it and
   brings returns back to them. It also delivers to customers in its own areas.
2. **Sorting hub** (`SORT`, Obour): every parcel going to another hub passes through here.
3. **Delivery hubs** (Dokki `GIZ`, Alexandria `ALX`, Tanta `DLT`, Assiut `AST`, Maadi `CAI-S`):
   couriers leave from here to the customer.

Which hub delivers to an address: the area's hub if the area has one, otherwise the governorate's
hub. A governorate with no hub is not served yet and parcels to it are refused at creation.

Routing is hub and spoke: if the parcel is not at its target hub, it goes to the sorting hub;
from the sorting hub it goes straight to the target hub.

## The day

| When (default) | What happens | Who | Screen |
| --- | --- | --- | --- |
| Until 18:00 | Merchant creates parcels, prints labels, asks for a pickup | Merchant | Merchant: New parcel, Pickups |
| Afternoon | Hub gives the pickup to a courier. Courier scans every label at the merchant | Hub staff, courier | Hub: Pickups. Courier: Pickups |
| Evening | Merchant hub scans the parcels in. Screen says where each one goes | Hub staff | Hub: Receive |
| Evening | Scan each parcel to sort: the system opens or picks the bag for its next hub. Seal bags | Hub staff | Hub: Sort and bags |
| Night | Create a trip, scan the sealed bags onto it, mark it departed | Hub staff | Hub: Trips |
| Night | Sorting hub receives the bags, sorts again into bags for delivery hubs, sends trips | Sorting staff | Hub: Receive, Sort, Trips |
| Early morning | Delivery hub receives the bags | Hub staff | Hub: Receive |
| Morning | Hub loads each courier's run by scanning, then marks it as leaving | Hub staff | Hub: Courier runs |
| Day | Courier delivers and collects the exact COD, or records why it failed | Courier | Courier: My run |
| Evening | Courier brings failed parcels back (scanned in) and hands over cash. Hub closes the run | Hub staff | Hub: Receive, Courier runs |
| Weekly | Admin pays the merchant: collected cash minus fees, for parcels whose cash is in | Admin | Admin: Money |

The promised date is set when the parcel enters the network (pickup scan or drop off):
today plus the zone's transit days, plus one day when it enters after the cutoff, skipping
weekend days (Friday by default).

## Statuses

| Status | Meaning | Where it is |
| --- | --- | --- |
| Created | Merchant made it, waiting for pickup | At the merchant |
| Picked up | Courier scanned it at the merchant | In the pickup courier's vehicle |
| At hub | Inside a hub, maybe already in a bag or loaded on a run | The hub |
| On hold | Back from a failed attempt, waiting for the merchant to decide | The hub's hold shelf |
| In transit | In a sealed bag on a line haul trip | On the road |
| Out for delivery | With a courier on a run (to the customer, or back to the merchant) | With the courier |
| Attempt failed | Courier could not deliver; still with the courier | With the courier |
| Delivered | Customer received it and paid | Done |
| Returned | Back with the merchant | Done |
| Cancelled | Merchant cancelled before pickup | Done |
| Lost | Admin marked it lost; scanning it anywhere marks it found | Unknown |

Every parcel also has a direction: **forward** to the customer or **return** to the merchant.
A return travels the same network backwards and is handed over on a courier run.

## When delivery fails

The courier picks a reason. When the parcel is scanned back at the hub:

1. Customer did not answer, not available, postponed, cannot pay, other: ready for another
   attempt the next day.
2. Wrong address, wrong phone, refused: **on hold**. The merchant either sends it out again
   (and can fix the phone, address or area) or asks for it back.
3. After the maximum attempts (3 by default) it turns into a return automatically.

The merchant can ask for any parcel back until it is out with a courier.

## Money

| Fee | When | Default |
| --- | --- | --- |
| Shipping | Every delivered or returned parcel. Zone price by size, minus the merchant's discount | Greater Cairo M: 60 EGP |
| COD fee | Delivered parcels, on the cash above the free amount | 1% above 3,000 EGP |
| Return fee | Returned parcels, as a share of shipping | 50% |

Couriers must collect the exact COD amount; no partial payments. At run close the hub types the
cash received; any difference is recorded against the courier (Admin: Money, courier cash).
A merchant's parcels become payable once the run that delivered them is closed.
