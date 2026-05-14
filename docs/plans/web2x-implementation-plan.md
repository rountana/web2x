# web2x — Implementation Plan

## Context

web2x ("Web to Anything") is a mobile-first PWA that accepts a URL and produces flashcards, quizzes, PDFs, and shareable summaries via LLM. The spec is at `.claude/specs/web2x-spec.md`. The repo is a greenfield — only the spec and git config exist. This plan builds the full application from scratch.

**User's setup:** Docker Compose for local PostgreSQL + Redis; Gemini API key in hand.

---

## Architecture Decisions (deviations from spec)

| Spec says | We do | Why |
|-----------|-------|-----|
| Anthropic prompt caching | Gemini only (`@google/generative-ai`) | Spec contradicts itself; Gemini is the named LLM throughout |
| mlx fallback | Dropped for MVP | mlx is Apple-Silicon-only; deployment target (Railway/Fly.io) is Linux x86 |
| `tool_use` structured output | Gemini `responseSchema` | Gemini Flash uses its own JSON-schema approach, not Anthropic tool_use |
| Anonymous mode + auth | Anonymous only at MVP | `userId` nullable; anon session UUID via `x-anon-id` header from `localStorage` |
| Quiz attempts stored | Ephemeral (client-side) | MVP simplicity; no auth context needed |
| iOS share_target | Android-first | iOS PWA share_target support is limited and unreliable |
| LLM cost gate | 5 LLM generations/hour/anon-session (Redis) | Spec section 12, option 6 |

---

## Phase 0 — Monorepo Scaffold

**Goal:** pnpm workspace builds cleanly; shared types compile.

### Files to create

```
/package.json                       # root — pnpm workspaces config
/pnpm-workspace.yaml                # workspaces: apps/*, packages/*
/docker-compose.yml                 # PostgreSQL 16 + Redis 7
/.gitignore
/packages/shared/package.json       # name: @web2x/shared
/packages/shared/tsconfig.json
/packages/shared/src/index.ts       # all shared types (Article, Deck, Quiz, Summary, API shapes)
```

**Key shared types** (`packages/shared/src/index.ts`):
- `Article`, `ArticleStatus`, `ArticleListItem`
- `FlashCard`, `Deck`, `CreateDeckRequest`
- `MCQuestion`, `OpenQuestion`, `QuizQuestion` (discriminated union), `Quiz`, `GradeRequest`, `GradeResponse`
- `Summary`, `CreateArticleRequest`, `CreateArticleResponse`, `PdfResponse`, `ApiError`

**docker-compose.yml:**
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: web2x_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
    ports: ["6379:6379"]
volumes:
  pgdata:
```

**Verify:** `pnpm --filter @web2x/shared build` → `dist/index.js` + `dist/index.d.ts` created

---

## Phase 1 — API Skeleton + Database

**Goal:** `curl http://localhost:3001/health` → `{"status":"ok"}`

### Files to create

```
/apps/api/package.json              # @web2x/api; deps: hono, @hono/node-server, drizzle-orm,
                                    #   pg, bullmq, ioredis, @google/generative-ai,
                                    #   @mozilla/readability, turndown, uuid, zod, puppeteer
/apps/api/tsconfig.json
/apps/api/drizzle.config.ts
/apps/api/.env.example
/apps/api/src/db/schema.ts          # Drizzle tables: articles, decks, quizzes, summaries
/apps/api/src/db/client.ts          # drizzle(Pool, { schema })
/apps/api/src/services/redis.ts     # singleton ioredis client
/apps/api/src/middleware/error.ts   # ValidationError, NotFoundError, global handler
/apps/api/src/middleware/rateLimit.ts  # 10 req/hr/IP ingestion; 5 LLM gen/hr/anon-session
/apps/api/src/app.ts                # Hono app, cors, routes mounted at /api/v1
/apps/api/src/index.ts              # serve() entry point on port 3001
```

**Drizzle schema tables:**
- `articles` — uuid PK, user_id text, source_url, title, raw_text, markdown_content, word_count, extracted_at, status enum(pending|ready|failed), error_message, created_at
- `decks` — uuid PK, article_id FK→articles (cascade), cards jsonb, generated_at
- `quizzes` — uuid PK, article_id FK, questions jsonb, generated_at
- `summaries` — uuid PK, article_id FK, key_points jsonb, overview text, generated_at

**Run after schema:** `pnpm --filter @web2x/api db:generate && db:migrate`

**Verify:** `curl http://localhost:3001/health`

---

## Phase 2 — Article Ingestion + BullMQ Worker

**Goal:** `POST /api/v1/articles` returns 202 with `{ id, status: "pending" }`; article reaches `status: "ready"` after extraction.

### Files to create

```
/apps/api/src/services/urlValidator.ts   # SSRF protection: blocks 10.x, 172.16.x, 192.168.x,
                                         #   127.x, 169.254.x, localhost, ::1, IPv6 ULA/link-local
                                         # Uses node:dns/promises to resolve + check all IPs
/apps/api/src/services/extractor.ts     # fetch → @mozilla/readability → turndown; returns
                                         #   { title, rawText, markdownContent, wordCount }
/apps/api/src/workers/queue.ts           # BullMQ Queue('extraction'); addExtractionJob(articleId, url)
/apps/api/src/workers/extractionWorker.ts  # Worker('extraction'): validate URL → fetch → readability
                                            #   → turndown → update articles table
/apps/api/src/workers/workerEntry.ts    # standalone process: new Worker(...)
/apps/api/src/routes/articles.ts        # POST /articles (validate, insert pending, enqueue)
                                         # GET /articles/:id (poll status)
                                         # GET /articles (list, paginated 20/page, scoped by x-anon-id)
                                         # DELETE /articles/:id
/apps/api/src/routes/shareTarget.ts     # GET /share-target?url= → POST /articles internally → redirect
```

**SSRF validator** must block:
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`
- `100.64.0.0/10` (CGNAT), `::1`, `fc00::/7`, `fe80::/10`
- `localhost`, `0.0.0.0`
- Non-http/https protocols

**Rate limit middleware** (already in Phase 1):
- Ingestion: 10 req/hr per IP (applies to all routes)
- LLM: 5 req/hr per anon-session (applies to POST `/deck`, `/quiz`, `/summary`, `/pdf`)

**Verify:**
```bash
# Happy path
curl -X POST http://localhost:3001/api/v1/articles \
  -H "Content-Type: application/json" -H "x-anon-id: test-session" \
  -d '{"url":"https://en.wikipedia.org/wiki/Machine_learning"}'
# → {"id":"<uuid>","status":"pending"}

# Poll
curl http://localhost:3001/api/v1/articles/<uuid>
# → {"status":"ready","title":"...","markdownContent":"..."}

# SSRF blocked
curl -X POST ... -d '{"url":"http://192.168.1.1/"}'
# → 400 {"error":"Private/reserved addresses are not allowed"}
```

---

## Phase 3 — LLM Service + Deck, Quiz, Summary Routes

**Goal:** Generate flashcards, quiz, and summary from a ready article.

### Files to create

```
/apps/api/src/services/llm.ts            # Gemini integration
/apps/api/src/routes/deck.ts             # POST /articles/:id/deck (idempotent), GET
/apps/api/src/routes/quiz.ts             # POST /articles/:id/quiz (idempotent), GET,
                                          #   POST /articles/:id/quiz/grade
/apps/api/src/routes/summary.ts          # POST /articles/:id/summary (idempotent), GET
```

**LLM service** (`services/llm.ts`):
- Client: `new GoogleGenerativeAI(GEMINI_API_KEY)`, model `GEMINI_MODEL` (env, default `gemini-2.5-flash-lite`)
- Use `responseSchema` for structured outputs (not tool_use)
- Three generation functions: `generateDeck(rawText, count)`, `generateQuiz(rawText, count)`, `generateSummary(rawText)`
- Grading function: `gradeAnswer(question, modelAnswer, userAnswer)` → `{ correct, score, feedback }`
- On Gemini API error: retry once (500ms delay), then throw — route surfaces error to client

**Structured output schemas for Gemini:**
- Deck: `{ cards: [{ front: string, back: string }] }`
- Quiz: `{ questions: [{ id, type, question, options?, correctAnswer, explanation }] }`
- Summary: `{ keyPoints: string[], overview: string }`

**Idempotency:** Each POST route checks for existing record (`SELECT WHERE article_id = ?`). If found, return existing. Only generate if missing.

**Verify:**
```bash
curl -X POST http://localhost:3001/api/v1/articles/<uuid>/deck \
  -H "Content-Type: application/json" -H "x-anon-id: test-session" \
  -d '{"count":5}' | jq '.cards | length'
# → 5

curl -X POST http://localhost:3001/api/v1/articles/<uuid>/quiz \
  -d '{"count":3}' | jq '.questions[0].type'
# → "multiple_choice"

curl -X POST http://localhost:3001/api/v1/articles/<uuid>/summary | jq '.keyPoints | length'
# → 3-5
```

---

## Phase 4 — PDF Export

**Goal:** `POST /articles/:id/pdf` returns a signed URL that downloads the article as a styled PDF.

### Files to create

```
/apps/api/src/services/pdf.ts   # Puppeteer: render article Markdown → HTML → PDF buffer
                                 # Upload to Supabase Storage (pdfs bucket)
                                 # Return signed URL (1hr TTL)
                                 # Schedule BullMQ delayed job to delete after 1hr
/apps/api/src/routes/pdf.ts     # POST /articles/:id/pdf → { url, expiresAt }
```

**PDF template:** Styled HTML with title, source URL, extraction date, and Markdown content rendered as HTML. Page margins, readable font, print-safe styling.

**Supabase Storage:** Use `@supabase/supabase-js` with service role key. Bucket: `pdfs` (private). Path: `<articleId>/<uuid>.pdf`.

**Verify:**
```bash
curl -X POST http://localhost:3001/api/v1/articles/<uuid>/pdf | jq '.url'
# → "https://...supabase.co/storage/v1/object/sign/pdfs/..."
```

---

## Phase 5 — React Frontend Shell

**Goal:** `http://localhost:5173` loads; URL input works end-to-end; PWA manifest installed.

### Files to create

```
/apps/web/package.json               # @web2x/web; deps: react, react-dom, react-router-dom,
                                      #   @tanstack/react-query, zustand, @web2x/shared
                                      # devDeps: vite, @vitejs/plugin-react, vite-plugin-pwa,
                                      #   tailwindcss, shadcn/ui setup
/apps/web/tsconfig.json
/apps/web/vite.config.ts             # plugin-react, vite-plugin-pwa, proxy /api → localhost:3001
/apps/web/tailwind.config.ts
/apps/web/postcss.config.js
/apps/web/public/manifest.json       # share_target: { action: "/share-target", method: "GET", params: { url: "url" } }
/apps/web/public/icons/icon-192.png  # placeholder PWA icons
/apps/web/public/icons/icon-512.png
/apps/web/index.html
/apps/web/src/index.css              # Tailwind directives
/apps/web/src/main.tsx               # QueryClientProvider + BrowserRouter
/apps/web/src/App.tsx                # Route definitions
/apps/web/src/lib/api.ts             # typed fetch client; reads x-anon-id from localStorage
/apps/web/src/store/articleStore.ts  # Zustand persist: articleIds[], articleCount, showInstallPrompt
```

**Vite proxy** (dev only): `/api` → `http://localhost:3001` (eliminates CORS in dev)

**manifest.json share_target:** `action: "/share-target"` (frontend route, not API). The `ShareTargetPage` component calls `POST /api/v1/articles` and redirects.

**Verify:** Dev server starts, `http://localhost:5173` loads blank home screen.

---

## Phase 6 — Frontend Pages + Components

**Goal:** Full user flows work in browser (URL → article → flashcards/quiz/summary/PDF).

### Files to create

```
/apps/web/src/hooks/useArticle.ts   # useArticle (polls if status=pending), useCreateArticle
/apps/web/src/hooks/useDeck.ts      # useDeck, useCreateDeck
/apps/web/src/hooks/useQuiz.ts      # useQuiz, useCreateQuiz, useGradeAnswer
/apps/web/src/hooks/useSummary.ts   # useSummary, useCreateSummary

/apps/web/src/pages/HomePage.tsx           # URL input form → POST /articles → /processing/:id
/apps/web/src/pages/ShareTargetPage.tsx    # reads ?url= → POST /articles → /processing/:id
/apps/web/src/pages/ProcessingPage.tsx     # skeleton screen; polls until ready → /articles/:id
/apps/web/src/pages/ArticleDetailPage.tsx  # title, wordCount, article prose;
                                            #   sticky bottom sheet: Flashcards | Quiz | PDF | Share
/apps/web/src/pages/FlashcardsPage.tsx     # auto-generate if no deck; renders CardDeck
/apps/web/src/pages/QuizPage.tsx           # one question/screen; MC: select → feedback;
                                            #   open-ended: textarea → grade API call → feedback
/apps/web/src/pages/SummaryPage.tsx        # key points + overview; Share button (navigator.share
                                            #   with clipboard fallback)

/apps/web/src/components/CardDeck.tsx      # touch swipe (onTouchStart/End, 60px threshold);
                                            #   tap to flip; "Got it" / "Review again" buttons;
                                            #   end-of-deck score screen
/apps/web/src/components/InstallPrompt.tsx # beforeinstallprompt listener; shows after 2nd article
```

**Key implementation details:**
- `useArticle` sets `refetchInterval: 2000` when `status === 'pending'`; stops when ready/failed
- `ArticleDetailPage` renders `markdownContent` as HTML (use `react-markdown`)
- `SummaryPage`: `navigator.share` if available; `navigator.clipboard.writeText` fallback
- `CardDeck` swipe: right (+dx) = "Got it"; left (-dx) = "Review again"
- Quiz MC: immediate feedback (color highlight + explanation); Open-ended: call `POST /quiz/grade`

**Verify:** Manual browser test of all 5 user flows from the spec (Share from app, Manual URL, Flashcards, Quiz, Summarize & Share).

---

## Phase 7 — PWA Polish

**Goal:** Lighthouse PWA score ≥ 90; offline viewing of cached articles works.

### Files to update

```
/apps/web/vite.config.ts   # Update VitePWA plugin: workbox runtimeCaching for
                             #   article API responses (CacheFirst, 7-day TTL)
                             #   and LLM outputs (CacheFirst, 30-day TTL)
```

**Workbox caching rules:**
- PWA shell (JS/CSS/HTML): `precacheAndRoute` (via vite-plugin-pwa)
- `GET /api/v1/articles/:id` when status=ready: `CacheFirst`, 7-day expiry
- `GET /api/v1/articles/:id/deck|quiz|summary`: `CacheFirst`, 30-day expiry
- `POST` routes: never cache

**Verify:**
```bash
npx lighthouse http://localhost:5173 --only-categories=pwa --output=json
# Target PWA score ≥ 90
```

---

## Environment Variables

**`/apps/api/.env.local`** (for local dev with Docker Compose):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/web2x_dev
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=<your-key>
GEMINI_MODEL=gemini-2.5-flash-lite
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_STORAGE_BUCKET=pdfs
API_PORT=3001
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

**`/apps/web/.env.local`** (dev proxies through Vite, so this can be empty):
```
# VITE_API_URL omitted → Vite proxy handles /api → localhost:3001
```

---

## Critical Files

| File | Why |
|------|-----|
| `packages/shared/src/index.ts` | Upstream of every other layer; all types originate here |
| `apps/api/src/db/schema.ts` | Drizzle tables; JSONB column types must match shared interfaces exactly |
| `apps/api/src/services/llm.ts` | All three generation tasks + grading; Gemini responseSchema |
| `apps/api/src/workers/extractionWorker.ts` | BullMQ pipeline: SSRF check → fetch → Readability → Turndown → DB |
| `apps/api/src/services/urlValidator.ts` | SSRF protection; must block all private/reserved IP ranges |
| `apps/web/public/manifest.json` | share_target registration; must point to frontend `/share-target` route |
| `apps/web/src/lib/api.ts` | Single typed API client; all hooks and pages use this |

---

## Implementation Order

Execute phases strictly in order — each depends on the previous:

1. Phase 0: Scaffold + shared types → `pnpm build` ✓
2. Phase 1: API skeleton + DB → `/health` ✓
3. Phase 2: Ingestion + worker → `POST /articles` → ready ✓
4. Phase 3: LLM + deck/quiz/summary routes → flashcards JSON ✓
5. Phase 4: PDF export → signed URL ✓
6. Phase 5: Frontend shell → dev server loads ✓
7. Phase 6: Pages + components → full browser flow ✓
8. Phase 7: PWA polish → Lighthouse ≥ 90 ✓

---

## End-to-End Verification Script

```bash
# Start services
docker compose up -d
pnpm --filter @web2x/api dev &
pnpm --filter @web2x/web dev &

# 1. Health
curl http://localhost:3001/health

# 2. SSRF protection
curl -X POST http://localhost:3001/api/v1/articles \
  -H "Content-Type: application/json" -d '{"url":"http://192.168.1.1/"}' 
# → 400

# 3. Ingest real article
ID=$(curl -s -X POST http://localhost:3001/api/v1/articles \
  -H "Content-Type: application/json" -H "x-anon-id: test" \
  -d '{"url":"https://en.wikipedia.org/wiki/Machine_learning"}' | jq -r '.id')

# 4. Poll until ready
until [[ $(curl -s http://localhost:3001/api/v1/articles/$ID | jq -r '.status') == "ready" ]]; do
  sleep 3; echo "pending..."
done

# 5. Generate all outputs
curl -s -X POST http://localhost:3001/api/v1/articles/$ID/deck -d '{"count":5}' | jq '.cards | length'
curl -s -X POST http://localhost:3001/api/v1/articles/$ID/quiz -d '{"count":3}' | jq '.questions | length'
curl -s -X POST http://localhost:3001/api/v1/articles/$ID/summary | jq '.keyPoints | length'
curl -s -X POST http://localhost:3001/api/v1/articles/$ID/pdf | jq '.url'

# 6. Rate limit
for i in {1..11}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/v1/articles \
    -H "Content-Type: application/json" -d '{"url":"https://example.com"}'
done
# First 10: 202, 11th: 429
```
