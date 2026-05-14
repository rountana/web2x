FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm

# ---- Builder ----
FROM base AS builder
WORKDIR /app

# Workspace manifests first — maximises layer cache reuse on dep changes
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter @web2x/shared build
RUN pnpm --filter @web2x/api build

# ---- Runner ----
FROM base AS runner

# Chromium for Puppeteer (extractor already passes --no-sandbox at launch)
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libatk-bridge2.0-0 \
    libgbm1 \
    libxss1 \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Production deps only
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --prod

# Compiled output
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# SQL migrations + drizzle meta journal (needed by programmatic migrator)
COPY --from=builder /app/apps/api/src/db/migrations ./apps/api/dist/db/migrations

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
