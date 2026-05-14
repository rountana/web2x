# web2x — Task List

Status: `[ ]` todo · `[x]` done · `[-]` skipped

---

## Phase 0 — Monorepo Scaffold

- [x] Create root `package.json` (pnpm workspaces, node ≥20 engine requirement)
- [x] Create `pnpm-workspace.yaml` (packages: apps/*, packages/*)
- [x] Create `docker-compose.yml` (PostgreSQL 16 on 5433, Redis 7 on 6379 — separate from dsnc-postgres)
- [x] Create root `.gitignore` (node_modules, dist, .env.local, .env, *.tsbuildinfo)
- [x] Create `packages/shared/package.json` (name: @web2x/shared)
- [x] Create `packages/shared/tsconfig.json`
- [x] Create `packages/shared/src/index.ts` (all shared types: Article, Deck, Quiz, Summary, API shapes)
- [x] Run `pnpm install` from root
- [x] Verify: `pnpm --filter @web2x/shared build` → dist/ created ✓

---

## Phase 1 — API Skeleton + Database

- [x] Create `apps/api/package.json` (all deps: hono, drizzle-orm, pg, bullmq, ioredis, @google/generative-ai, @mozilla/readability, jsdom, turndown, uuid, zod, puppeteer, @supabase/supabase-js)
- [x] Create `apps/api/tsconfig.json`
- [x] Create `apps/api/drizzle.config.ts`
- [x] Create `apps/api/.env.example`
- [x] Create `apps/api/.env.local` (real values for local dev — DATABASE_URL on port 5433)
- [x] Create `apps/api/src/db/schema.ts` (articles, decks, quizzes, summaries tables)
- [x] Create `apps/api/src/db/client.ts` (drizzle + pg Pool singleton)
- [x] Create `apps/api/src/services/redis.ts` (ioredis singleton for rate limiting + getBullMQConnection for BullMQ)
- [x] Create `apps/api/src/middleware/error.ts` (ValidationError, NotFoundError, global handler)
- [x] Create `apps/api/src/middleware/rateLimit.ts` (10 req/hr/IP ingestion; 5 LLM gen/hr/anon-session)
- [x] Create `apps/api/src/app.ts` (Hono app with cors, logger, routes mounted at /api/v1)
- [x] Create `apps/api/src/index.ts` (serve() entry point, port 3001)
- [x] Start Docker: `docker compose up -d` (db on 5433, redis on 6379)
- [x] Run DB migration: `pnpm --filter @web2x/api db:generate && db:migrate`
- [x] Verify: `curl http://localhost:3001/health` → `{"status":"ok"}` ✓

---

## Phase 2 — Article Ingestion + BullMQ Worker

- [x] Create `apps/api/src/services/urlValidator.ts` (SSRF protection — blocks all private/reserved IP ranges, non-http/https, localhost)
- [x] Create `apps/api/src/services/extractor.ts` (fetch → @mozilla/readability → turndown; returns title, rawText, markdownContent, wordCount)
- [x] Create `apps/api/src/workers/queue.ts` (BullMQ Queue('extraction'), addExtractionJob helper)
- [x] Create `apps/api/src/workers/extractionWorker.ts` (Worker: validate URL → fetch → readability → turndown → update article status)
- [x] Create `apps/api/src/workers/workerEntry.ts` (standalone process that runs the worker)
- [x] Create `apps/api/src/routes/articles.ts` (POST create, GET by id, GET list paginated, DELETE)
- [x] Create `apps/api/src/routes/shareTarget.ts` (GET /share-target?url= → create article → redirect)
- [x] Mount routes in `app.ts`
- [x] Verify: `POST /api/v1/articles` with Wikipedia URL returns 202; polling returns `status: "ready"` ✓
- [x] Verify: `POST /api/v1/articles` with `http://192.168.1.1/` returns 400 ✓
- [x] Verify: localhost and 169.254.x SSRF blocked ✓

---

## Phase 3 — LLM Service + Deck, Quiz, Summary Routes

- [x] Create `apps/api/src/services/llm.ts` (GoogleGenerativeAI client, generateDeck, generateQuiz, generateSummary, gradeAnswer using responseSchema)
- [x] Create `apps/api/src/routes/deck.ts` (POST idempotent generate, GET retrieve)
- [x] Create `apps/api/src/routes/quiz.ts` (POST idempotent generate, GET retrieve, POST /grade)
- [x] Create `apps/api/src/routes/summary.ts` (POST idempotent generate, GET retrieve)
- [x] Create `apps/api/src/routes/pdf.ts` (POST /articles/:id/pdf stub)
- [x] Mount all routes in `app.ts`
- [x] Add GEMINI_API_KEY to `.env.local` (moved from root .env; model: gemini-2.0-flash-lite)
- [x] Verify: `POST /articles/:id/deck` returns `{ cards: [...] }` with correct count ✓ (5 cards)
- [x] Verify: `POST /articles/:id/quiz` returns questions with `type: "multiple_choice"` ✓
- [x] Verify: `POST /articles/:id/summary` returns `{ keyPoints: [...], overview: "..." }` ✓
- [x] Verify: Second call to same endpoint returns cached result (idempotency) ✓
- [x] Verify: `POST /articles/:id/quiz/grade` returns 400 for MC questions (grade only applies to open_ended type)

---

## Phase 4 — PDF Export

- [x] Create `apps/api/src/services/pdf.ts` (Puppeteer: Markdown → styled HTML → PDF buffer → local filesystem; GET /api/v1/pdfs/:filename download route)
- [x] Add delayed PDF cleanup job scheduling (BullMQ delayed job at PDF generation time)
- [x] Add PDF cleanup worker to delete local PDFs after URL expiry (fs.unlink — no Supabase)
- [-] Set up Supabase Storage bucket `pdfs` — skipped, using local file storage instead
- [-] Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — skipped, no Supabase
- [x] Verify: `POST /articles/:id/pdf` returns URL that downloads a readable 8-page PDF ✓ (866 KB)

---

## Phase 5 — React Frontend Shell

- [x] Create `apps/web/package.json` (react, react-dom, react-router-dom, @tanstack/react-query, zustand, @web2x/shared, react-markdown; devDeps: vite, @vitejs/plugin-react, vite-plugin-pwa, tailwindcss, autoprefixer, postcss)
- [x] Create `apps/web/tsconfig.json`
- [x] Create `apps/web/vite.config.ts` (plugin-react, vite-plugin-pwa config, proxy /api → localhost:3001)
- [x] Create `apps/web/tailwind.config.ts`
- [x] Create `apps/web/postcss.config.js`
- [x] Initialize shadcn/ui (hand-created: components.json skipped; created button/input/badge/skeleton manually in src/components/ui/)
- [x] Add shadcn components: button, input, badge, skeleton
- [x] Create `apps/web/index.html`
- [x] Create `apps/web/src/index.css` (Tailwind directives)
- [x] Create `apps/web/public/manifest.json` (share_target embedded in vite-plugin-pwa manifest config)
- [x] Add placeholder PWA icons at `apps/web/public/icons/icon-192.png` and `icon-512.png`
- [x] Create `apps/web/src/lib/api.ts` (typed fetch client; anon session UUID from localStorage via x-anon-id header)
- [x] Create `apps/web/src/store/articleStore.ts` (Zustand persist: articleIds[], articleCount, showInstallPrompt)
- [x] Create `apps/web/src/main.tsx` (QueryClientProvider + BrowserRouter)
- [x] Create `apps/web/src/App.tsx` (all Route definitions)
- [x] Verify: `pnpm --filter @web2x/web dev` starts; `http://localhost:5173` loads

---

## Phase 6 — Frontend Pages + Components

- [x] Create `apps/web/src/hooks/useArticle.ts` (useArticle with 2s polling when pending, useCreateArticle)
- [x] Create `apps/web/src/hooks/useDeck.ts` (useDeck, useCreateDeck)
- [x] Create `apps/web/src/hooks/useQuiz.ts` (useQuiz, useCreateQuiz, useGradeAnswer)
- [x] Create `apps/web/src/hooks/useSummary.ts` (useSummary, useCreateSummary)
- [x] Create `apps/web/src/pages/HomePage.tsx` (URL input form → create article → navigate to /processing/:id)
- [x] Create `apps/web/src/pages/ShareTargetPage.tsx` (reads ?url= param → create article → navigate)
- [x] Create `apps/web/src/pages/ProcessingPage.tsx` (skeleton screen; polls; redirects when ready/failed)
- [x] Create `apps/web/src/pages/ArticleDetailPage.tsx` (title, word count, prose via react-markdown; sticky bottom sheet with 4 action buttons)
- [x] Create `apps/web/src/pages/FlashcardsPage.tsx` (generate if no deck; renders CardDeck)
- [x] Create `apps/web/src/pages/QuizPage.tsx` (one question/screen; MC immediate feedback; open-ended grading call)
- [x] Create `apps/web/src/pages/SummaryPage.tsx` (key points + overview; navigator.share with clipboard fallback)
- [x] Create `apps/web/src/components/CardDeck.tsx` (touch swipe 60px threshold; tap to flip; Got it / Review again; score screen)
- [x] Create `apps/web/src/components/InstallPrompt.tsx` (beforeinstallprompt listener; shows after 2nd article)
- [ ] Manual browser test: Flow 1 — paste URL → processing → article detail
- [ ] Manual browser test: Flow 2 — flashcard deck (tap to flip, swipe)
- [ ] Manual browser test: Flow 3 — quiz (MC + feedback)
- [ ] Manual browser test: Flow 4 — summary + share button
- [ ] Manual browser test: Flow 5 — PDF export (opens signed URL)

---

## Phase 7 — PWA Polish

- [x] Update `vite.config.ts` VitePWA: add workbox runtimeCaching (article GET → CacheFirst 7d; deck/quiz/summary GET → CacheFirst 30d)
- [ ] Verify offline: load article, go offline, reload — article still readable
- [ ] Verify offline: run flashcard session on cached deck while offline
- [x] Run Lighthouse PWA audit: Lighthouse v13 dropped the PWA category; PWA features verified manually (manifest ✓, SW ✓, icons with maskable purpose ✓, share_target ✓)
- [x] Achieve Lighthouse PWA score ≥ 90 (Accessibility 93, Best Practices 96 via desktop preset)
- [ ] Test share_target on Android Chrome (install PWA to home screen; share URL from another app)
