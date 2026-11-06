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

## Server side as built (2026-11-06)

Migration `20261127090000_zones_from_areas`: `store_areas` (geo_area_id key, dark_store_id and
zone_id together or both null, needs_review, note, created_by), `zones.legacy_area` (copied
from `zones.area`), `geo_areas.merged_into_id`, `orders.geo_area_id`, `orders.resolved_by`,
`orders.location_source`, `deliveries.delivered_lat/lng`, `delivered_points` (one per order,
keyed by the cleaned address text).

Decisions taken while building it:

- **Zone polygon.** `zones.area` stays the stored shape: the union of the zone's areas minus the
  areas inside them that another zone serves or that are excluded. A zone that never had an
  area keeps its drawn outline (so a database without an area map, like the tests, works as
  before); once a zone has areas it can no longer be drawn (`zone_uses_areas`). Drawing a new
  zone selects the areas at least 60% inside the shape (neighbourhoods where the map has them,
  else districts); with no area map the shape is kept as the outline.
- **Who serves an area** (chosen area or the area the text names): its own row or its nearest
  ancestor's. When areas inside it are served elsewhere or excluded, or nobody above it has a
  row, its shape decides: at least 98% inside one zone is served, nothing inside any zone is
  outside (district or finer), anything else is unsure. So a district split between stores is
  unsure, and the customer is asked for the neighbourhood or a pin.
- **Several areas named equally** (two districts, or one name in two places of the same
  district): served only when every one of them gets the same zone, otherwise unsure
  (`stores_tie`). A name found in several districts with none of them named is not used.
- **Points.** A pin, Shopify's own coordinates, a saved Google answer and a learned address
  are map points: the zone whose polygon holds the point decides, nearest store first when old
  outlines overlap (the other stores are returned as `alternatives`, so coverage can still fall
  back to an open store). A learned point (two deliveries within 150 m) is a real door point
  too. The engine's old made up points in `geocode_cache` (method `engine`) are ignored.
- **Google** runs only when a key (or `GEOCODER=osm` locally) is configured, after the
  customer's choice and before the engine. When it fails and the engine is unsure, checkout
  answers 503 so Shopify asks again in 30 seconds instead of caching "no rate".
- **Fulfillment with another store's address** (Shopify sent it to a location whose store does
  not serve the decided place): rejected with `UNDELIVERABLE_DESTINATION` and a
  `shopify_wrong_store` alert, never delivered across the city. An unsure address raises a
  `shopify_rejected` alert with the reason.
- **Rider position.** The completion call takes `lat`/`lng`; without them the rider's last ping
  is used when it is fresher than `tracking.rider_stale_minutes`.
- **Clean up** (`cleanUpAreas`, idempotent, then the dictionary and the outline move, together
  `prepareAreaMap`, at API start, after a places import and in the seed): duplicate districts
  (same name under the same governorate) are merged into the one with most children (its shape
  is all the pieces, re-joined after a reload of the base map; children, customers,
  suggestions, orders and store rows are repointed; the others become inactive with
  `merged_into_id`); a neighbourhood or compound without a district gets the district holding
  at least half of it; a level 3 or 4 area covering a fifth of a district with the district's
  own name (El Shorouk City) is folded into it. The dictionary can now also name a
  neighbourhood or compound (El Mukkatam, Al Mearag City, the two Ashrafiya compounds); "Dar
  Misr" alone stays ambiguous (it is in several cities), "Dar Misr El Andalus" is New Cairo.
- **Outline move**: neighbourhoods and compounds (districts where the map has none) whose
  combined share inside the drawn outlines is at least 60% go to the zone holding the largest
  part; a compound only gets its own row when it lands somewhere other than its neighbourhood.
  An area where a second store holds at least 5% is marked `needs_review` and listed, with the
  zones that got no area, in one `zone_areas_review` alert. It runs once (audit row
  `zones.areas_from_outlines`), and never while store_areas has rows or the map has no
  districts.
- **Echo rule**: only a governorate swallows a district of the same name ("Giza"); a
  neighbourhood sharing its district's name is the more precise answer and stays.

Endpoints for the web task (all under the existing guards):

- `GET /admin/zones/areas?bbox=minLng,minLat,maxLng,maxLat&districtId=&levels=2,3&q=&cursor=&limit=`
  → `{ areas: [{ id, level, parentId, nameEn, nameAr, owner: { darkStoreId, zoneId, excluded,
  inherited, needsReview } | null, geometry }], nextCursor }` (operations view)
- `GET /admin/zones/areas/review` → areas the outline move marked for review
- `POST /admin/zones/:id/areas { areaId, move? }`, `POST /admin/zones/:id/areas/select { shape,
  level=3, minShare?, move? }`, `DELETE /admin/zones/areas/:areaId`,
  `POST /admin/zones/areas/:areaId/exclude { note? }` (operations manage); refusals
  `area_served_by_other_store`, `hub_has_no_zones`, `area_level_not_assignable`,
  `zone_uses_areas` (on `PUT /admin/zones/:id/area`)
- `POST /admin/zones` takes the drawn `area` as optional and answers `{ id, assigned, skipped,
  outline }`
- `GET /coverage?areaId=` and `GET /coverage/search?q=` (public; served areas, top 10);
  coverage answers `address_unsure` as a reason and returns `area`; `location` is only a real point
- `POST /merchant/orders`, `POST /admin/orders`: `latitude`/`longitude` optional, `areaId`
  optional, one of them required; `409 address_unsure` when the area cannot be served for sure
- Storefront proxy: `GET /apps/shiplynow/search?q=` → `[{ areaId, level, nameEn, nameAr,
  parent, zoneId, store }]`; `availability` and `store` take `area=` or `lat=&lng=` (or the old
  `zone=`) and answer `zone`, `area` and `decision: { status, reason }`
- `POST /rider/deliveries/:id/complete` takes optional `lat`, `lng`

Measurement (`scripts/geo-eval.mjs <file>` against a database with the areas; read only): on a
fixed sample of 300 of the 1,116 Greater Cairo Nabta addresses, with live's areas and the
outline move computed read only on live, the old engine placed 6.0% (unsure 24.0%, outside
70.0%) and the new decision serves 8.0% (unsure 21.0%, outside 71.0%). Most outside answers are
real (the pilot zones cover a small part of Greater Cairo); most unsure ones name only a
district split between stores (Maadi, New Cairo), which the area picker or a pin resolves.

## Screens as built (2026-11-06)

- **Admin zone map** (Operations, Configuration, Delivery zones, `/admin/zones`;
  `ZonesWorkspace` + `AreaZoneMap`). Leaflet on OpenStreetMap tiles, canvas rendering. The map
  asks `GET /admin/zones/areas` for its box, 500 a page, up to 8 pages; below zoom 13 only
  districts (zones then show their stored shape filled, so neighbourhoods served far out still
  show), from zoom 13 districts become outlines under neighbourhoods and compounds. Colours: one
  per store (legend), "not served" grey and dashed, "needs review" amber dashed, nobody a thin
  grey line; the selected zone's areas are drawn thicker, the chosen area black. Store chips,
  the store's zones, "New zone" (code and names only, no drawing). With a zone selected a tap
  assigns the area (`POST /admin/zones/:id/areas`), a tap on one of the zone's own areas removes
  it, an area served through its district does nothing, and an area of another store asks
  first and is sent with `move: true`. Every tap also opens an area card: who serves it, Add to,
  Remove from its zone or Clear the not served mark, Mark not served, Select its zone. The zone
  panel lists its own areas with counts per level (new `zoneId` filter on
  `GET /admin/zones/areas`), each with Remove and a jump to it on the map; "Select areas in a
  shape" (Geoman, neighbourhoods, districts or compounds) calls `/areas/select` and offers "Move
  those too" when areas of another store were skipped. Switch off and Delete zone stay; the
  old Edit border is gone. A name search (Arabic or English) jumps to any area. The To review
  tab lists `GET /admin/zones/areas/review` with Keep in its zone, Move to the selected zone,
  Mark not served and Show on map. On a phone the map is full width with the panel below.
- **Manual order form** (`/merchant/orders/new`, `/admin/orders/new`): a neighbourhood search
  (`GET /coverage/search`, debounced, Arabic or English; each answer now carries the area's
  `bbox` only to frame a map) and an optional pin map (tap to drop, drag to correct; the map
  opens on the chosen neighbourhood). The coverage answer shows as soon as an area or pin is
  chosen (`GET /coverage?lat&lng` when there is a pin, else `?areaId`): open, closed until,
  full, outside, or `address_unsure` ("choose the exact neighbourhood or drop a pin"). The
  order sends `areaId` and/or `latitude`/`longitude`, never a zone centre.
- **Storefront widget** (theme app extension, plain JavaScript): the picker is a neighbourhood
  search (`/apps/shiplynow/search`, 300 ms debounce, two letters at least, results announced)
  plus "Use my location" (browser geolocation, https only). No map pin: the extension does not
  load any map library and adding Leaflet from a CDN was ruled out to keep it small. The choice
  is kept in localStorage (`{ areaId, names, zoneId }` or `{ pin, zoneId }`; an old `{ zoneId }`
  still works) and on the cart through `/cart/update.js`: `_shiplynow_area` or `_shiplynow_pin`
  ("lat,lng", 6 decimals), the other cleared, and `_shiplynow_zone` (for a pin, written once the
  answer names the zone). Availability and the area page are asked with `area=` or `lat=&lng=`.
  An unsure answer reopens the picker with a kind note asking for the neighbourhood; outside
  says 60 minute delivery does not reach the place yet; the choice is no longer wiped when the
  place is not served. The pure helpers (placeParams, cartAttributes, roundPin, debounce) are
  exported for Node, and the API's browser test (`storefront-widget.test.ts`) drives the search,
  the location button and the unsure note. Merchants get the new widget only after their app is
  deployed again (`pnpm shopify:merchant-app --name <merchant> --client-id <id>`, or the
  self-service kit's `npx @shopify/cli@latest app deploy`); nothing changes in the theme editor.
