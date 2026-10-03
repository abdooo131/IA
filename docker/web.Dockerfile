# Shiply Next.js web apps. Build with --build-arg APP=merchant|ops and PORT.
FROM node:22-bookworm-slim
ARG APP
ARG PORT=3000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1 PORT=$PORT APP=$APP
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/merchant/package.json apps/merchant/
COPY apps/ops/package.json apps/ops/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@shiply/${APP}..."
COPY packages packages
COPY apps/${APP} apps/${APP}
RUN pnpm --filter @shiply/shared build && pnpm --filter "@shiply/${APP}" build
WORKDIR /repo/apps/${APP}
EXPOSE ${PORT}
CMD ["sh", "-c", "npx next start -p $PORT"]
