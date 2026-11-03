# Product growth engine

A multi tenant Python engine for Shopify stores advertised on Meta. For each tenant (one Shopify store plus its
Meta ad accounts) it measures spend, CPM, CPA, CAC and profit per product, models demand as traffic x conversion
with lost sales split into price and stock causes, suggests purchase orders (pushed to Shopify only after
approval), and decides per product and style whether to TEST, RESTOCK FIRST, FIX PRICE, SCALE, KILL, CUT SPEND or
MAINTAIN, with a 3 month plan.

The code lives in `src/engine/` (Python package `engine`); the repository also holds an unrelated Java project
(`src/*.java`, `bin/`).

## Setup

Requirements: Python 3.11+, Postgres (on a Mac: `brew install postgresql@16` then
`brew services start postgresql@16`; Neon works too).

```bash
cd IA                        # the repository folder
python3 -m venv .venv        # once: a private Python for the engine (the launcher expects it here)
source .venv/bin/activate    # in every new Terminal window
pip install -e .             # add [dev] for pytest and httpx
engine --help                # migrations run automatically on every command
```

Database: without `DATABASE_URL` the engine uses `postgresql://localhost:5432/engine`, the local Postgres with
your Mac login as the database user (what Homebrew sets up); the screen creates that `engine` database if it is
missing. For another server set it, e.g. `export DATABASE_URL=postgresql://user:pass@host:5432/engine` (in
`~/.engine_env` to keep it).

Secrets never go in the database. A tenant row stores the *names* of the env vars that hold its tokens; set them
in the environment of every process that runs the CLI for that tenant:

| Env var (name chosen per tenant) | Holds |
|---|---|
| e.g. `EVE_SHOPIFY_TOKEN` | Shopify Admin API access token of the store's custom app (`shpat_...`) |
| e.g. `EVE_META_TOKEN` | Meta system user access token |
| `DATABASE_URL` | Postgres URL (CLI and collector) |

A missing env var fails with an error naming it. Tokens are redacted from stage errors, logs and terminal output.

### Shopify custom app (one per store)

Create a custom app in the store admin (Settings > Apps and sales channels > Develop apps) and grant these Admin
API scopes:

* `read_orders`, `read_all_orders` (full order history, Spec 15), `read_products`, `read_inventory`,
  `write_inventory`, `read_locations`, `read_customers` (Spec A3)
* `read_reports`: ShopifyQL landing page sessions (`shopifyqlQuery`). Without it the `ingest_landing_sessions`
  stage records a warning and views fall back to the pixel or the units only model.
* `read_inventory_transfers`, `write_inventory_transfers`: **to verify** on the store's API version
  (`2025-10`, `config.SHOPIFY_API_VERSION`); recent versions gate `inventoryTransfer*` behind these scopes.

The API client keeps every query under Shopify's 1,000 point single query cost, paginates nested connections and
retries THROTTLED responses and HTTP 429 / 5xx with backoff.

### Meta

A Business Manager system user with `ads_read` on every listed ad account; generate a token for it and store it
in the tenant's Meta env var. The token is sent as an `Authorization: Bearer` header, never in a URL. Ad accounts
must use the shop currency (`tenant add` refuses others) and should use the shop timezone (`tenant add` warns when
they differ: Meta days are account days). History is read one month per request; Meta rate limit and transient
errors (codes 1, 2, 4, 17, 341, 80004, HTTP 5xx) are retried.

### Storefront pixel and collector

1. Deploy the collector (FastAPI) with the same `DATABASE_URL`, e.g. on Render:
   `uvicorn engine.collector.app:app --host 0.0.0.0 --port $PORT --no-access-log`.
   Run it with `--no-access-log`: uvicorn's access log would record client IP addresses, and the collector
   stores no personal data beyond a hashed session id.
2. In the store admin, Settings > Customer events > Add custom pixel: paste the pixel part of
   `src/engine/collector/pixel.js`, with `COLLECTOR_URL`, `TENANT_ID` and `PIXEL_KEY` (printed by `tenant add`,
   column `tenants.pixel_key`).
3. Add the theme snippet from the same file so the theme publishes `size_selected` (variant id, available) when a
   size is chosen; adapt the variant change event to the theme.

## Screen (local web UI)

A screen in the browser for the store owner, on top of the same engine. It runs on your own computer only
(it listens on `127.0.0.1`, never on the network).

```bash
engine ui                    # opens http://127.0.0.1:8765 in the browser; Ctrl+C stops it
engine ui --demo             # a sample store with made up data (Demo Boutique, EGP) in its own database
engine ui --port 8800 --no-browser
```

* **Double click launcher (macOS):** `scripts/Engine.command` goes to the repository, activates `.venv` (made
  with the Setup steps above), reads `~/.engine_env` if present and runs `engine ui`. Double click it in Finder
  (the first time, right click > Open). If `.venv` is missing or the screen stops with an error, the window says
  what to do and waits for Enter.
* **Database:** the screen uses `DATABASE_URL` like every command (it also reads `~/.engine_env`); when it is not
  set, the default local database `postgresql://localhost:5432/engine` (created if missing, never wiped). If the
  database cannot be reached, the screen still opens and shows a Setup page that explains what to do (for
  Homebrew: `brew services start postgresql@16`).
* **Port:** if the port is busy (the screen is probably already open), `engine ui` says so and stops; use
  `--port` for another one.
* **Demo:** `--demo` wipes and fills the database `engine_demo` on the `DATABASE_URL` server (created if missing;
  `--demo-db URL` to choose another; it refuses the engine's own database and any database holding a real store),
  then runs the monthly cycle twice. Shopify and Meta are answered by an in
  process fake store (`src/engine/demo.py`); Send to Shopify only creates a fake transfer id. Every page shows the
  banner "Sample store, made up data".

| Page | What it shows and does |
|---|---|
| Overview | This month's decision per style and per product as cards (decision, why in plain words, sales, ad spend, profit per currency unit of ads, days of stock left), the last cycle's status, and what waits for you: draft POs, colour matches to review, ads without a product |
| Lost sales | Per style: sold, lost to sold out sizes and lost to price as bars on one scale, plus the table with the unexplained residual |
| Scorecard | The full monthly scorecard (Spec 32) per style or per product, sortable, flags as chips |
| Purchase orders | POs by state; a PO page lists its lines (product, size, suggested, approved, received). Edit approved quantities and Approve; Send to Shopify and Cancel ask for a second click (Yes, send / Yes, cancel); Sync receipts |
| Plan | The 3 month plan per style: ad spend, units, sales, profit and the linked PO |
| Run | Run monthly cycle (in the background, one at a time per store, with live stage progress), Take stock snapshot, Sync PO receipts |
| Setup | Connect a store (tokens are written only to `~/.engine_env`, mode 600, as `<STORE>_SHOPIFY_TOKEN` and `<STORE>_META_TOKEN`; the history then loads in the background), suppliers, colour matches to confirm, manual ad map, main location, promo days |

Every page states the run and month it shows (default: the latest done run; another run can be picked). With
more than one store, a store picker appears in the header. Safety: requests must use the local address
(`127.0.0.1:<port>` or `localhost:<port>`), every form carries a per process random token, and posts from other
sites are refused. As in the CLI, nothing reaches Shopify except Send to Shopify of an approved PO (and Cancel of a
sent one); running the cycle never approves or sends.

## CLI

Every command takes `--tenant` (tenant id or name) except `tenant add` and `tenant list`; `cycle`,
`snapshot_stock` and `po sync` take `--all-tenants` instead.

| Command | What it does |
|---|---|
| `engine tenant add --name N --shop S.myshopify.com --shopify-token-env E1 --meta-token-env E2 --meta-account ID ... --po-prefix P` | Register a store (timezone, currency and primary location from Shopify), print the pixel key, ingest the full history, propose lineage and attribute the whole history (`--no-ingest` to skip) |
| `engine tenant list` | Tenants |
| `engine tenant set-location LOCATION_GID` | Change the main location (PO transfer destination) |
| `engine ingest [--since D --until D]` | Products, orders, Meta spend, landing sessions, funnel roll-up |
| `engine snapshot_stock` | Today's inventory levels (run daily); the first snapshot reconstructs stock history from sales |
| `engine lineage propose` / `list` / `confirm OLD NEW` | Old variant -> new variant matches (unique matches auto confirm); review and confirm the rest |
| `engine attribute [--since D --until D]` | Spend to products and order credits |
| `engine ad-map set AD_ID PRODUCT=SHARE ...` / `ad-map list` | Manual ad -> product map for ads that neither the catalog breakdown nor the ad name identifies |
| `engine lift set STYLE FACTOR --tested-on D` | Lift test result for a style (multiplies the ad response) |
| `engine calendar promo START END [--off]` | Flag promo days (a seasonal flag of the model) |
| `engine fit [--grain G --level L --run R]` | Fit demand models (a new done run unless `--run`) |
| `engine decide` / `plan` / `report [--out DIR]` | Scorecard and decisions, forward plan, report (CSV per section) |
| `engine backtest [--grain --level --folds]` | Rolling backtest and scoring of stored forecasts |
| `engine suppliers add NAME --kind factory --lead-time 30 [--pack N --moq N --style S \| --product P]` / `suppliers list` | Suppliers, lead times, pack multiples, MOQs |
| `engine po suggest` / `list` / `approve PO [--edit VARIANT=QTY]` / `push PO` / `sync` / `cancel PO` | Purchase orders |
| `engine cycle` | The monthly operating cycle |
| `engine ui [--port P --demo --demo-db URL --no-browser]` | The local web screen (see above) |

## Operating cycle

* **Once:** `tenant add` (full history: orders, spend up to 36 months, attribution), suppliers, review
  `lineage list` and `lineage confirm`, `ad-map set` for unmapped ads shown in the report.
* **Daily:** `engine snapshot_stock --all-tenants` (stock history and size availability depend on it);
  `engine po sync --all-tenants` (receipts of pushed POs).
* **Monthly (on the 1st):** `engine cycle --all-tenants`. Stages: sync products, ingest orders (incremental, last
  7 days re-read), ingest spend, landing sessions (optional), funnel roll-up (optional), lineage proposals,
  attribution (from the earliest unattributed order or spend day), meta factor, fit, score earlier runs whose
  forecast periods completed, decisions for the previous month, draft POs, forward plan, rolling backtest. Each
  stage is recorded in `runs.stages`; a required stage failure fails the run, an optional one records a warning.
  The cycle never approves, pushes or cancels a PO.
* **Then:** read `engine report`, approve and push POs with `po approve` / `po push` (the only Shopify writes:
  inventory transfer create, mark ready to ship, cancel, for approved POs only).

## Verify on a live store

These behaviours are implemented from the documentation and recorded fixtures; check them on the first real store:

- [ ] **Transfer receipts:** received = `shippedQuantity - processableQuantity` on `InventoryTransfer.lineItems`
      (`ingest_shopify.fetch_transfer`); compare with the admin after a partial receipt.
- [ ] **ShopifyQL rows shape:** `shopifyqlQuery { tableData { rows } }` rows as objects keyed by column name
      (`landing_page_path`, `day`, `sessions`), the `LIMIT` clause and the row cap (`ingest_shopify.LANDING_LIMIT`).
- [ ] **utmParameters shape:** `customerJourneySummary.lastVisit.utmParameters { source content }`, and the
      landing page URL fallback (`ingest_shopify._utm`).
- [ ] **Transfer tag search:** `inventoryTransfers(query: "tag:'<PO number>'")` finds a transfer created with that
      tag (`purchasing._find_transfer`), so a crashed push is reused or cancelled, not duplicated.
- [ ] **Meta product_id breakdown:** catalog insights `breakdowns=product_id` return retailer ids such as
      `shopify_EG_<product>_<variant>` or bare variant ids (`lineage.catalog_to_variant`); unknown ids go to the
      pool and are listed in the report's unmapped ads.
- [ ] **Islamic holiday dates:** `aggregate._ISLAMIC` (Egypt, 2022 to 2028; moon sighting may shift a day); a
      warning is logged for years outside the table.
- [ ] **Primary location:** `location` without an id returns the shop's primary location; otherwise
      `tenant set-location`.
- [ ] **Scopes:** whether `read_inventory_transfers` / `write_inventory_transfers` are needed on the API version.
- [ ] **Query cost:** actual `extensions.cost` of the products, orders and stock queries stays under the bucket.

## Tests

```bash
export TEST_DATABASE_URL=postgresql://postgres@localhost:5432/engine_test   # dropped and recreated
pytest -q
```

Shopify and Meta are always faked with recorded JSON under `tests/fixtures/`; the fake Shopify client rejects any
query whose requested cost exceeds 1,000 points.
