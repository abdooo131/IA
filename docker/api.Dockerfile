# Shiply API (prototype image: full workspace install so migrations and the seed script can run in it).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/merchant/package.json apps/merchant/
COPY apps/ops/package.json apps/ops/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @shiply/api... --filter @shiply/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @shiply/shared build && pnpm --filter @shiply/api build
WORKDIR /repo/apps/api
EXPOSE 4000
# Apply pending migrations (non destructive) then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
