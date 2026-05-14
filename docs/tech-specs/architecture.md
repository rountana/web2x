# Architecture

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, React Router v6 |
| Server state | TanStack Query v5 |
| Client state | Zustand (localStorage persistence) |
| PWA | vite-plugin-pwa, Workbox |
| Backend framework | Hono 4 (Node adapter) |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 + pgvector |
| Job queue | BullMQ (Redis 7) |
| AI — generation | Google Gemini 2.0 Flash Lite (structured JSON output) |
| AI — embeddings | MLX nomic-embed-text-v1.5 (local service, optional) |
| Package manager | pnpm 9 (workspaces) |
| Runtime | Node 20+ |

---

## Monorepo Layout

```
web2x/
├── apps/
│   ├── api/                  # Backend — Hono API server + workers
│   │   └── src/
│   │       ├── index.ts      # Entry: starts server + workers
│   │       ├── app.ts        # Hono app, middleware, route mounts
│   │       ├── routes/       # Route handlers
│   │       │   ├── workspaces.ts   # Workspace CRUD
│   │       │   ├── articles.ts     # Article CRUD (workspace-scoped)
│   │       │   ├── chat.ts         # RAG chat (workspace-scoped)
│   │       │   └── ...             # deck, quiz, summary, pdf, md, ingest
│   │       ├── services/     # Business logic + external clients
│   │       ├── workers/      # BullMQ background workers
│   │       ├── middleware/   # Error handler, rate limiter, workspace validator
│   │       ├── db/           # Drizzle client, schema, migrations
│   │       └── scripts/      # One-shot maintenance scripts
│   └── web/                  # Frontend — React PWA
│       └── src/
│           ├── pages/        # Route-level page components
│           ├── components/   # Reusable UI components
│           │   └── WorkspaceSwitcher.tsx  # Workspace dropdown UI
│           ├── hooks/        # TanStack Query hooks
│           │   └── useWorkspace.ts        # Workspace hooks + bootstrap
│           ├── store/        # Zustand stores
│           │   ├── articleStore.ts        # Article IDs for PWA hints
│           │   └── workspaceStore.ts      # Active workspace state
│           └── lib/          # API client, utilities
└── packages/
    └── shared/               # Shared TypeScript types (API contract)
```

---

## Service Topology

```
Browser (port 5173 dev / PWA)
    │
    ├─ REST JSON ──────────────► Hono API (port 3001)
    │                                │
    └─ SSE stream ◄─────────────────┤
                                     ├─ PostgreSQL :5433
                                     ├─ Redis :6379
                                     │    └─ BullMQ queues
                                     │         ├─ ExtractionWorker  (concurrency 5)
                                     │         ├─ ChunkingWorker    (concurrency 2)
                                     │         └─ PdfCleanupWorker  (concurrency 3)
                                     ├─ Gemini API (Google)
                                     └─ MLX service :8001 (optional, local)
```

The API server and workers share the same process in development (`src/index.ts` starts all of them). In production, workers can be split to a separate process via `pnpm worker` (`workerEntry.ts`).

---

## Key Design Decisions

**Workspace-scoped content** — All articles, RAG chat, and AI features are scoped to a workspace. The active workspace is identified by the `x-workspace-id` header (UUID stored in `localStorage`). A `workspaceMiddleware` validates ownership on every content request, preventing cross-workspace data access. Deleting a workspace cascades through all its content.

**Workspace bootstrap** — On first visit, the frontend auto-creates a "My Workspace" via `useBootstrapWorkspace()`. A loading gate in `App.tsx` prevents any content requests until the workspace is initialized.

**Async-first ingestion** — HTTP handlers return immediately (202 / 201) and enqueue BullMQ jobs. This keeps the frontend UX responsive while extraction (network-bound) and chunking (CPU/memory-bound) happen in the background.

**Anonymous identity** — No accounts. A UUID is generated on first visit and persisted in `localStorage`. It travels as the `x-anon-id` header on every request. Workspaces are user-scoped: `workspaces.user_id` must match `x-anon-id` on every workspace operation.

**Graceful MLX fallback** — All embedding and chat paths attempt the local MLX service first, catch `MlxUnavailableError`, and fall back to Gemini. The app works end-to-end without MLX installed.

**Idempotent generation** — Deck, quiz, and summary routes check for an existing record before calling Gemini. Re-calling them is safe and returns the cached result instantly.

**pgvector for RAG** — Article chunks are stored with 768-dim embeddings indexed via HNSW (cosine distance). The chat route does a single raw SQL vector similarity search filtered by `workspace_id`, instead of using a full vector database.

**PWA Share Target** — The `manifest.json` registers `/share-target?url=` as an OS-level share handler. The browser navigates to the frontend React route `/share-target`, which calls the API client (with the active workspace header) to create the article.
