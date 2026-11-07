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
