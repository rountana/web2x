# web2x — Technical Specs Index

**Last updated:** 2026-04-30  
**Status:** Current (reflects implemented code)

---

## Files in this folder

| File | What it covers |
|---|---|
| [architecture.md](./architecture.md) | System overview, stack, monorepo layout, service topology |
| [data-models.md](./data-models.md) | PostgreSQL schema, shared TypeScript types, relationships |
| [api.md](./api.md) | Every API endpoint — routes, request/response shapes, rate limits |
| [services-workers.md](./services-workers.md) | Backend services, BullMQ workers, external integrations (Gemini, MLX) |
| [frontend.md](./frontend.md) | React app — pages, hooks, state, PWA config, API client |
| [data-flows.md](./data-flows.md) | End-to-end flows for each major feature |
| [infrastructure.md](./infrastructure.md) | Docker Compose, env vars, migrations, deployment notes |
| [search-architecture.md](./search-architecture.md) | Query understanding layer, retrieval modes, design options |
| [dev-features/search-algorithms.md](./dev-features/search-algorithms.md) | Modular search strategy specs: BM25, Metadata, Vector, RAG, CSV, Hybrid, Knowledge Graph |
| [light-ontology.md](./light-ontology.md) | Lightweight ontology spec — entity types, predicate vocabulary, type-compatibility matrix (Phase 4 KG prerequisite) |

---

## One-paragraph summary

web2x is a monorepo PWA that turns any URL, PDF, or pasted text into flashcards, quizzes, summaries, and PDFs using AI. Content is organized into **Workspaces** — named containers that scope the article library, RAG chat, and all AI features. The backend is a Hono/Node API backed by PostgreSQL (Drizzle ORM) and Redis (BullMQ job queues). Heavy work — article extraction, text embedding, LLM generation — runs asynchronously in background workers. The frontend is a React/Vite PWA with TanStack Query for server state and Zustand for local state. All AI generation uses Google Gemini (structured JSON output); vector embeddings for semantic chat search use a local MLX service with Gemini as fallback. Authentication remains anonymous (UUID stored in `localStorage`); workspaces are created per anonymous identity and scoped to it via the `x-anon-id` header.
