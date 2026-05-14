FROM node:20-slim AS web-builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm --filter @web2x/shared build
RUN pnpm --filter @web2x/web build

FROM caddy:2-alpine AS runner
COPY --from=web-builder /app/apps/web/dist /srv
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
