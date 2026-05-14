# Infrastructure

## Docker Compose (`docker-compose.yml`)

Two services for local development:

| Service | Image | Port | Purpose |
|---|---|---|---|
| `postgres` | postgres:16 | 5433 (host) → 5432 (container) | Primary database |
| `redis` | redis:7 | 6379 | Job queues + rate limiting |

PostgreSQL credentials: `postgres/postgres`, database: `web2x_dev`  
Persistent volume: `pgdata`

Start: `docker compose up -d`

---

## Environment Variables

### API (`apps/api/.env.local`)

| Variable | Default | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | — | Yes | `postgresql://postgres:postgres@localhost:5433/web2x_dev` |
| `REDIS_URL` | — | Yes | `redis://localhost:6379` |
| `GEMINI_API_KEY` | — | Yes | Google Generative AI key |
| `GEMINI_MODEL` | `gemini-2.0-flash-lite` | No | |
| `API_PORT` | `3001` | No | |
| `API_BASE_URL` | `http://localhost:3001` | No | Used to build PDF download URLs |
| `CORS_ORIGIN` | `http://localhost:5173` | No | |
| `MLX_SERVICE_URL` | `http://localhost:8001` | No | Optional local inference service |
| `PDF_STORAGE_DIR` | `./uploads/pdfs` | No | Relative to process cwd |
| `NODE_ENV` | — | No | Set to `development` to disable rate limiting |

### Frontend (`apps/web`)

No `.env` needed for local dev — the Vite dev server proxies `/api` to `http://localhost:3001`.

---

## Database Migrations

Managed by Drizzle Kit. Config: `apps/api/drizzle.config.ts`

```bash
# From apps/api or using pnpm filter:
pnpm --filter api db:generate   # generate migration from schema changes
pnpm --filter api db:migrate    # apply pending migrations
pnpm --filter api db:studio     # open Drizzle Studio UI
```

Migration files: `apps/api/src/db/migrations/`

| File | What it adds |
|---|---|
| `0000_marvelous_whizzer.sql` | `articles`, `decks`, `quizzes`, `summaries` tables + enum |
| `0001_article_chunks.sql` | `article_chunks` table, pgvector extension, HNSW index |
| `0002_workspaces.sql` | `workspaces` table; `workspace_id` FK + NOT NULL on `articles`; workspace index |

**pgvector must be available in PostgreSQL** before `0001` can run. The official `postgres:16` Docker image does not include it. Use `pgvector/pgvector:pg16` or install the extension manually.

**Note on `0002_workspaces.sql`:** This migration truncates `articles` (dev app only — no real data) before making `workspace_id` NOT NULL, then adds the FK constraint. Running `drizzle-kit migrate` may report success without applying the migration if the Drizzle tracking table is out of sync; verify by checking `\d workspaces` in psql and apply directly if needed:
```bash
docker exec -i <postgres-container> psql -U postgres -d web2x_dev < apps/api/src/db/migrations/0002_workspaces.sql
```

---

## Scripts

```bash
# Start everything (API + frontend in parallel)
pnpm dev

# API only
pnpm --filter api dev

# Frontend only
pnpm --filter web dev

# Workers only (separate process)
pnpm --filter api worker

# Backfill embeddings for articles that have none
pnpm --filter api chunk:backfill

# Build all packages
pnpm build

# Type check
pnpm typecheck
```

---

## Ports Summary

| Service | Port |
|---|---|
| Frontend (Vite dev) | 5173 |
| API (Hono) | 3001 |
| PostgreSQL | 5433 |
| Redis | 6379 |
| MLX service (optional) | 8001 |

---

## Key npm Packages

### Backend

| Package | Purpose |
|---|---|
| `hono` | Web framework |
| `drizzle-orm` + `drizzle-kit` | ORM + migration tooling |
| `pg` | PostgreSQL driver |
| `bullmq` | Job queue |
| `ioredis` | Redis client |
| `@google/generative-ai` | Gemini API |
| `@mozilla/readability` + `jsdom` | Article extraction |
| `turndown` | HTML → Markdown |
| `unpdf` | PDF text extraction |
| `puppeteer` | PDF generation (headless Chrome) |
| `zod` | Input validation |

### Frontend

| Package | Purpose |
|---|---|
| `react` + `react-dom` | UI framework |
| `react-router-dom` | Routing |
| `@tanstack/react-query` | Server state |
| `zustand` | Client state |
| `react-markdown` | Markdown rendering |
| `lucide-react` | Icons |
| `tailwindcss` | Styling |
| `vite-plugin-pwa` + `workbox-window` | PWA + service worker |

---

## Security Notes

- **SSRF:** URL validator does a DNS lookup and rejects all private/reserved IP ranges before fetching
- **PDF tokens:** Filenames are UUIDs — no enumeration possible; server validates the UUID pattern on download
- **Workspace isolation:** All content routes require `x-workspace-id`; `workspaceMiddleware` validates ownership (workspace must belong to the `x-anon-id` user) before any handler runs. All DB queries for articles/chunks/decks/quizzes/summaries are filtered by `workspace_id`. Cross-workspace data leaks are structurally prevented.
- **Last-workspace protection:** `DELETE /workspaces/:id` returns 400 `LAST_WORKSPACE` if the user has only one workspace — prevents orphaned content.
- **Rate limiting:** Disabled in `development`; in production, 10 req/hr per IP globally, 5 req/hr per user for LLM paths
- **Secure headers:** Hono `secureHeaders()` middleware on all routes
- **HTML escaping:** All user-supplied content is HTML-escaped before being rendered in generated pages (md route, pdf HTML)
