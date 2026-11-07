# Shiply Core

Parcel management for next day delivery. Merchants hand us parcels, we pick them up, sort them,
move them between hubs overnight and deliver them the next day, collecting cash on delivery.
No stock and no warehouse: this system only manages parcels. It is separate from Shiply Now.

Read [docs/FLOW.md](docs/FLOW.md) for how a parcel moves and who does what.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | NestJS REST API on port 4100 |
| `apps/web` | Next.js web app on port 3100: `/admin`, `/hub`, `/courier`, `/merchant`, `/track` |
| `packages/db` | Prisma schema, migrations and seed |
| `packages/shared` | Statuses, routing, pricing, dates and money rules shared by every app |
| `scripts/demo.mjs` | Pushes demo parcels through every stage using the real API |

## Run locally

Needs Node 22, pnpm 10 and Docker (or a local PostgreSQL 16).

```bash
cd shiply-core
pnpm install
cp .env.example .env        # then set JWT_SECRET and SEED_ADMIN_PASSWORD
pnpm db:up                  # PostgreSQL 16 on port 5433
pnpm db:deploy              # create the tables
pnpm db:seed                # zones, 27 governorates, hubs, demo accounts
pnpm dev                    # API on :4100, web on :3100
node scripts/demo.mjs       # optional: demo parcels at every stage
```

Open http://localhost:3100.

## Demo accounts

Password `demo12345` (from `SEED_DEMO_PASSWORD`). The admin uses `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

| Who | Email |
| --- | --- |
| Admin | `admin@shiply.local` |
| Merchants | `merchant@evechantelle.example` (Heliopolis, Obour), `merchant@nilehome.example` (Alexandria) |
| Obour facility | `staff.obr@` supervisor, `inbound.obr@`, `sorting.obr@`, `outbound.obr@`, first mile `courier.obr@` (all `@shiply.local`) |
| Alexandria facility | the same with `alxsf` |
| Last mile hubs | `staff.<hub>@shiply.local` and `courier.<hub>@shiply.local` for `caie`, `cais`, `giz`, `dlt`, `ast`, `alx`, `dmn` |

## Tests

```bash
pnpm test
```

The API test walks parcels through the company flow (pickup to the nearest facility, inbound,
sorting and outbound teams, facility to facility line haul, last mile delivery, refusal, return
through the facility, three failed attempts, cash, payout, tracking privacy, team permissions) on a new
database it creates and drops itself, so it never touches existing data.

## Rules the code keeps

1. Money is integer piastres. Never floats.
2. Every status change goes through one function that checks the allowed moves, updates the row
   only if nobody changed it meanwhile, and writes the event in the same transaction.
3. Parcel history (`shipment_events`) and `audit_log` are append only, enforced by the database.
4. Business values (cutoff, weekend days, max attempts, fees, tracking prefix) are settings, not code.
5. Hub staff can only act in their own hub; couriers only see their own pickups and runs;
   merchants only their own parcels.
6. Public tracking never shows the address, phone or fees.
