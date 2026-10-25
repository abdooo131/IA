# Shiply Now

Pilot of 60 minute delivery for Shopify merchants, run from dark stores in Greater Cairo.
Read [CLAUDE.md](CLAUDE.md) for the scope and the rules, and [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
for the step by step build plan.

## Layout

| Path                       | What                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `apps/api`                 | NestJS REST API. OpenAPI docs at `http://localhost:4000/docs` |
| `apps/web`                 | Next.js app with the `/admin`, `/store` and `/rider` areas    |
| `packages/db`              | Prisma schema, migrations and seed                            |
| `packages/shared`          | Types, zod schemas and constants shared by every app          |
| `design/shiply-ui-handoff` | Brand handoff: UI spec, tokens, fonts, icons, logos           |
| `legacy/java`              | The earlier Java Swing project, kept for reference            |

## Run locally

Needs Node 22, pnpm 10 and Docker.

```bash
pnpm install
cp .env.example .env        # then set JWT_ACCESS_SECRET and SEED_ADMIN_PASSWORD
pnpm db:up                  # Postgres 16 with PostGIS, and Redis
pnpm db:deploy              # apply migrations
pnpm db:seed                # create the admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
pnpm dev                    # API on :4000, web on :3000
```

Open http://localhost:3000 and sign in with the seeded admin.

The web app proxies `/api/*` to the API, so the auth cookies stay on the web origin.

## Checks

```bash
pnpm lint        # ESLint and Prettier
pnpm typecheck
pnpm test        # needs `pnpm db:up`; API tests use TEST_DATABASE_URL and wipe it
pnpm build
```

CI runs the same four commands on every push and pull request.

## Auth

Email and password, hashed with argon2id. Login sets two httpOnly cookies: a short lived
access JWT (`ACCESS_TOKEN_TTL_SECONDS`) and an opaque refresh token (`REFRESH_TOKEN_TTL_DAYS`)
that is stored only as a hash and rotated on every use. Reusing a rotated refresh token
revokes every session of that user. API clients can also send the access token as
`Authorization: Bearer`.

Roles: `admin`, `merchant`, `store_staff`, `rider`. Admins can open every area,
store staff open `/store`, riders open `/rider`. Merchants have no web area in the pilot.
