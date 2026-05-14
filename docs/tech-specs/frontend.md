# Frontend

## Stack

React 18 + Vite + TypeScript + TailwindCSS  
PWA via `vite-plugin-pwa` + Workbox  
Routing: React Router v6  
Server state: TanStack Query v5  
Client state: Zustand (localStorage persistence)

Dev server: port 5173. All `/api` requests proxied to `http://localhost:3001`.

---

## Pages (`apps/web/src/pages/`)

### `HomePage.tsx`

Main entry point. Three input modes:

| Mode | Input | API call |
|---|---|---|
| Link | One or more URLs | `POST /articles` per URL |
| Text | Paste markdown/plain text + optional title | `POST /articles/ingest/markdown` |
| PDF | Upload file + optional title | `POST /articles/ingest/pdf` |

After successful submission → navigates to `/processing/:id`.

Also shows: recent article list (from Zustand store), per-article status badges, clipboard paste shortcut.

---

### `ProcessingPage.tsx`

Polls `GET /articles/:id` every 2 seconds while `status === 'pending'`.  
Auto-redirects to `/articles/:id` when `status === 'ready'`.  
Shows error state with message if `status === 'failed'`.

---

### `ArticleDetailPage.tsx`

Displays rendered `markdownContent` (via `react-markdown`).  
Bottom nav actions:

| Action | Destination |
|---|---|
| Flashcards | `/articles/:id/flashcards` |
| Quiz | `/articles/:id/quiz` |
| Summary | `/articles/:id/summary` |
| PDF | `POST /articles/:id/pdf` → open URL in new tab |
| View .md | `GET /articles/:id/md` → open in new tab |
| Chat | `/chat?articleId=:id` |

---

### `FlashcardsPage.tsx`

Auto-generates deck on first visit (`useCreateDeck`). Renders `CardDeck` component.

---

### `QuizPage.tsx`

Auto-generates quiz on first visit. One question per screen.

- **Multiple choice:** 4 option buttons; instant colour feedback on selection
- **Open-ended:** Textarea + "Check" button → calls `/quiz/grade` → shows score + feedback
- Progress bar + final score screen with retry option

---

### `SummaryPage.tsx`

Auto-generates summary on first visit. Shows bullet `keyPoints` + prose `overview`.  
Share button: `navigator.share()` if available, else copy-to-clipboard fallback.

---

### `ChatPage.tsx`

RAG chat interface. Optional `?articleId=` param scopes retrieval to one article.

- Reads SSE stream from `POST /chat`
- Accumulates tokens into assistant message in real time
- Renders response as Markdown
- Shows source citation badges after stream completes
- `Enter` to send, `Shift+Enter` for newline
- Disabled while streaming

---

### `ShareTargetPage.tsx`

Receives `?url=` from the OS share sheet. Calls `POST /articles`, then redirects to `/processing/:id`. Shows a spinner during submission.

---

## Hooks (`apps/web/src/hooks/`)

All hooks use TanStack Query. Default `staleTime`: 30s.

| Hook | Query key | Purpose |
|---|---|---|
| `useArticle(id)` | `['article', id]` | Fetch article; refetchInterval 2s if pending |
| `useArticleList(page)` | `['articles', page]` | Paginated list |
| `useCreateArticle()` | mutation | POST URL; invalidates article list |
| `useIngestMarkdown()` | mutation | POST markdown |
| `useIngestPdf()` | mutation | POST PDF |
| `useDeck(articleId)` | `['deck', articleId]` | Fetch existing deck |
| `useCreateDeck(articleId)` | mutation | Generate deck |
| `useQuiz(articleId)` | `['quiz', articleId]` | Fetch existing quiz |
| `useCreateQuiz(articleId)` | mutation | Generate quiz |
| `useGradeAnswer(articleId)` | mutation | Grade open-ended answer |
| `useSummary(articleId)` | `['summary', articleId]` | Fetch existing summary |
| `useCreateSummary(articleId)` | mutation | Generate summary |

---

## Components (`apps/web/src/components/`)

### `CardDeck.tsx`

Flashcard study UI:
- Click to flip (front/back)
- Swipe left = mastered, swipe right = review again
- Progress counter, completion screen, restart button

### `ChatInput.tsx`

Auto-resizing textarea (max 120px). Enter sends, Shift+Enter newlines. Disabled during streaming.

### `InstallPrompt.tsx`

PWA "Add to Home Screen" banner. Listens for `beforeinstallprompt`. Shown after user's 2nd article is created. Dismissible. State managed via Zustand.

### UI primitives

Shadcn-style components in `components/ui/`: `Button`, `Input`, `Badge`, `Skeleton`.

---

## State Management (`apps/web/src/store/`)

### `workspaceStore.ts` — Zustand + localStorage (primary)

Persisted under key `web2x-workspace`. Only `activeWorkspaceId` is persisted; the workspace list is always fetched fresh from the server on mount.

| State | Type | Purpose |
|---|---|---|
| `activeWorkspaceId` | `string \| null` | ID of the currently selected workspace |
| `workspaces` | `Workspace[]` | In-memory list of all user workspaces (not persisted) |
| `isBootstrapped` | `boolean` | True once the initial workspace list has been loaded |

Actions: `setActiveWorkspaceId`, `setWorkspaces`, `addWorkspace`, `removeWorkspace`, `renameWorkspace`, `setBootstrapped`

`removeWorkspace` auto-selects the next available workspace when the active one is deleted.

### `articleStore.ts` — Zustand + localStorage

Persisted under key `web2x-articles`. Used for PWA offline hints and the install prompt trigger.

| State | Type | Purpose |
|---|---|---|
| `articleIds` | `string[]` | LIFO list of recent article IDs |
| `articleCount` | `number` | Cumulative count (triggers install prompt at 2) |
| `showInstallPrompt` | `boolean` | Controls install banner visibility |

Actions: `addArticleId`, `removeArticleId`, `setShowInstallPrompt`

---

## Hooks (`apps/web/src/hooks/`)

All hooks use TanStack Query. Default `staleTime`: 30s.

| Hook | Query key | Purpose |
|---|---|---|
| `useWorkspaces()` | `['workspaces']` | List all workspaces; syncs result into store |
| `useCreateWorkspace()` | mutation | Create workspace; sets as active |
| `useRenameWorkspace()` | mutation | Rename; updates store + cache |
| `useDeleteWorkspace()` | mutation | Delete; store auto-selects next |
| `useSwitchWorkspace()` | plain fn | Set active workspace ID + sync localStorage |
| `useBootstrapWorkspace()` | effect | On mount: fetch workspaces or create default "My Workspace" |
| `useArticle(id)` | `['article', id]` | Fetch article; refetchInterval 2s if pending |
| `useArticleList(page)` | `['articles', workspaceId, page]` | Paginated list; enabled only when workspace is set |
| `useCreateArticle()` | mutation | POST URL; invalidates workspace-scoped list |
| `useIngestMarkdown()` | mutation | POST markdown |
| `useIngestPdf()` | mutation | POST PDF |
| `useDeck(articleId)` | `['deck', articleId]` | Fetch existing deck |
| `useCreateDeck(articleId)` | mutation | Generate deck |
| `useQuiz(articleId)` | `['quiz', articleId]` | Fetch existing quiz |
| `useCreateQuiz(articleId)` | mutation | Generate quiz |
| `useGradeAnswer(articleId)` | mutation | Grade open-ended answer |
| `useSummary(articleId)` | `['summary', articleId]` | Fetch existing summary |
| `useCreateSummary(articleId)` | mutation | Generate summary |

The `useArticleList` query key includes `workspaceId` so switching workspaces automatically invalidates and refetches the list with no extra code.

---

## Components (`apps/web/src/components/`)

### `WorkspaceSwitcher.tsx`

Dropdown button in the `HomePage` header showing the active workspace name. On open:
- Lists all workspaces with a checkmark on the active one; click to switch
- Per-workspace: pencil icon (inline rename input) + trash icon (confirmation before delete; disabled if only one workspace)
- "New workspace" entry at the bottom (inline name input → create)

Workspace switches invalidate the `['articles']` query cache, causing the article list to reload for the new workspace.

### `CardDeck.tsx`

Flashcard study UI:
- Click to flip (front/back)
- Swipe left = mastered, swipe right = review again
- Progress counter, completion screen, restart button

### `ChatInput.tsx`

Auto-resizing textarea (max 120px). Enter sends, Shift+Enter newlines. Disabled during streaming.

### `InstallPrompt.tsx`

PWA "Add to Home Screen" banner. Listens for `beforeinstallprompt`. Shown after user's 2nd article is created. Dismissible. State managed via Zustand.

### UI primitives

Shadcn-style components in `components/ui/`: `Button`, `Input`, `Badge`, `Skeleton`.

---

## API Client (`apps/web/src/lib/api.ts`)

Exports:
- `getAnonId()` — singleton UUID from `localStorage` (`web2x_anon_id`)
- `getWorkspaceId()` / `setWorkspaceId(id)` — active workspace ID from `localStorage` (`web2x_active_workspace_id`)

All `request()` calls include both `x-anon-id` and (if set) `x-workspace-id` headers automatically.

```typescript
api.workspaces.list()
api.workspaces.create({ name })
api.workspaces.rename(id, { name })
api.workspaces.delete(id)

api.articles.create(url)
api.articles.ingestMarkdown(content, title?)
api.articles.ingestPdf(file, title?)
api.articles.get(id)
api.articles.list(page)
api.articles.delete(id)

api.deck.generate(articleId, count?)
api.deck.get(articleId)

api.quiz.generate(articleId, count?)
api.quiz.get(articleId)
api.quiz.grade(articleId, questionId, userAnswer)

api.summary.generate(articleId)
api.summary.get(articleId)

api.pdf.generate(articleId)
```

`HomeChat.tsx` and `ChatPage.tsx` make raw `fetch` calls to `/api/v1/chat` (SSE streaming). Both import `getAnonId` and `getWorkspaceId` from `api.ts` and set both headers manually.

---

## PWA Configuration (`apps/web/vite.config.ts`)

### Manifest

- Name: `web2x`
- Icons: 192px + 512px
- `share_target`: `{ action: "/share-target", method: "GET", params: { url: "url" } }`

### Workbox Caching

| Cache | Strategy | Max age | Max entries |
|---|---|---|---|
| Article responses | Cache-first | 7 days | 50 |
| Deck/quiz/summary | Cache-first | 30 days | 150 |
| PWA shell (JS/CSS) | Auto (precache) | — | — |

Service worker auto-updates on new deploy.

---

## Routing (`apps/web/src/App.tsx`)

| Path | Page |
|---|---|
| `/` | HomePage |
| `/share-target` | ShareTargetPage |
| `/processing/:id` | ProcessingPage |
| `/articles/:id` | ArticleDetailPage |
| `/articles/:id/flashcards` | FlashcardsPage |
| `/articles/:id/quiz` | QuizPage |
| `/articles/:id/summary` | SummaryPage |
| `/chat` | ChatPage |
| `*` | Redirect to `/` |
