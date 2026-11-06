# Zones from areas and one delivery decision (agreed 2026-11-06)

Why: a test on 1,116 real Cairo and Giza Shopify addresses placed only 7% in a zone, about
3 in 10 of those went to the wrong store, and five entry points decided the store in five
different ways (see the review summary at the end).

Owner's decisions: zones are built from areas; one decision everywhere; an unsure address
gets no 60 minute rate at checkout; the customer drops a map pin (free) and Google stays an
optional later addition; a paid order whose address turns out to be outside is rejected so
the merchant ships it normally.

## 1. Areas are assigned to stores

- `store_areas`: (geo_area_id, dark_store_id), each area at most one store, only dark
  stores (never hubs). Usually neighbourhoods (level 3) or whole districts (level 2); a
  compound (level 4) may be assigned on its own when it straddles a border.
- An area is served when it or its nearest assigned ancestor is assigned: assigning a
  district serves every neighbourhood inside it unless one of them is assigned to another
  store or marked excluded (`store_areas` row with dark_store_id null = explicitly not
  served).
- Zones stay as the customer facing unit and keep their ids (orders, settings and Shopify
  locations refer to them): a zone is now a named group of assigned areas of one store
  (`store_areas.zone_id`), and its polygon is computed as the union of its areas' shapes
  (stored, recomputed on every change) so maps, point checks and the rate still work.
- Migration: every neighbourhood (and compound) whose shape lies at least 60% inside an
  existing zone polygon is assigned to that zone's store and zone; areas split between
  stores go to the store holding the larger part and are listed for review. Old polygons
  are kept in `zones.legacy_area` for one release.
- Admin (Operations, Configuration, Delivery zones): the map shows areas coloured by store;
  click an area (or a district) to assign it to the selected zone, click again to remove,
  or mark it not served. Draw is kept only as "select the areas inside this shape". Every
  change is audited.

## 2. One decision for every entry point

`resolveDelivery(input)` in packages/db (used by the API everywhere):

- input: any of a map point, a chosen area or zone id (widget, cart attribute), the
  address text, and the city/governorate fields.
- order of trust: a map point (pin, rider position history, cached Google answer) → a
  chosen area or zone from the widget → the address text through the area engine.
- output: `{ status: 'served' | 'outside' | 'unsure', store, zone, area, confidence,
  doorPoint: point | null, reason }`. `doorPoint` is only ever a real point (pin or
  geocoder), never a made up point inside an area.
- the store is the store that owns the deepest assigned area; capacity and hours are
  checked after, by the caller, as today (`store_closed`, `at_capacity`).

Callers:

| Entry point | Rule |
|---|---|
| Checkout rate | rate only when served and the store is the planned origin, open, under capacity, with every item; unsure or outside: no 60 minute rate |
| Fulfillment request | first the decision the cart carried (`_shiplynow_zone` / `_shiplynow_area` / pin attributes), else resolveDelivery; outside or unsure: rejected (merchant ships normally); a store different from the location Shopify chose raises shopify_wrong_store as today |
| Manual order form | area picker of neighbourhoods plus an optional pin; no more zone centre as the customer's location |
| Widget and area page | the customer picks a neighbourhood (search in Arabic and English) or drops a pin; the store comes from resolveDelivery; zone names are never the pick list |
| Customer places | district from resolveDelivery only when served or the engine was certain; unsure stays unplaced |

## 3. Matching rules (area engine)

- The governorate never backs a street or a neighbourhood on its own.
- A district or neighbourhood named outright wins over anything outside it; a street only
  narrows inside an area already chosen and never picks the district.
- Whole word matches only (no "حسن الاكبر" matching "حسن").
- Generic or numbered names (Street 9, Neighbourhood 8, Italian district, Palm Hills) need
  their parent named; otherwise unsure.
- A tie between areas of different stores, or a name that exists in several districts with
  no parent named, answers unsure; never an arbitrary pick.
- Numbers glued to names are split ("sherouk1" → "sherouk 1"); "جسر" joins the street words
  (so "جسر السويس" is not Suez).

## 4. Data clean up

- Merge duplicate districts, give parentless neighbourhoods and compounds their parent by
  location, fix El Shorouk's level, and add the missed names to AREA_DICTIONARY (El
  Mokattam spellings, Sherouk, Dar Misr, Ashrafeya, Maraag, Zahraa El Maadi...).

## 5. Real points

- Map pin in the widget, the area page and the manual order form; the pin travels on the
  cart (`_shiplynow_pin`) and the order.
- The rider app saves the phone position at delivery on the delivery (`delivered_lat`,
  `delivered_lng`); over time the address text to point cache learns from delivered orders
  (an address seen delivered twice within 150 m becomes a trusted answer).
- Google stays optional behind the Geocoder (`GOOGLE_MAPS_API_KEY`), used before the engine
  only when configured.

## Review summary (2026-11-06)

1,116 Nabta orders in Greater Cairo provinces, no coordinates: 7% placed, 24% unsure, 68%
outside; of 238 that name a served area only 16% were decided; of 21 placed, 6 went to the
wrong store. Causes: governorate backing any street, streets outweighing the named district,
partial name matches, generic names without parents, missing spellings, rough zone outlines
(the Fifth Settlement zone covers 34% of its district, Maadi 25%), and five entry points
deciding differently (checkout engine first; fulfillment Google first and accepting with no
zone when nothing was found; manual orders using the zone centre; the widget taking the store
straight from the zone).
