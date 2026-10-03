# Shiply

Courier platform prototype for Elassal Holding (brand: Shiply, first merchant: Eve Chantelle).

* `apps/api`: NestJS backend (Postgres 16 + PostGIS via Prisma)
* `apps/merchant`: merchant web portal (Next.js + Tailwind)
* `apps/ops`: internal operations dashboard (Next.js + Tailwind)
* `packages/shared`: shared types, status machine, validation
* `packages/ui`: React pieces shared by the two web apps
* `e2e`: Playwright smoke tests

See [RUN.md](RUN.md) to start it and [DECISIONS.md](DECISIONS.md) for the choices made along the way.

The `src/`, `bin/` and Eclipse files at the root belong to an earlier, unrelated Java project and are not part of Shiply.
