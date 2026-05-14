# web2x — Web to Anything

Turn any article or webpage into flashcards, quizzes, and summaries using AI. Paste a URL and web2x extracts the content, sends it through Google Gemini, and gives you ready-to-study learning materials — no account required.

## Features

- **Flashcards** — AI-generated cards for spaced-repetition learning
- **Quizzes** — Multiple-choice questions with AI-graded open answers
- **Summaries** — Key points and overview of any article
- **PDF Export** — Download articles as clean PDFs
- **Progressive Web App** — Install on any device, works offline
- **Web Share Target** — Share URLs directly from your browser or mobile share menu
- **No account needed** — Anonymous usage tracked via a local ID

## Tech Stack

**Frontend**
- React 18 + TypeScript, Vite, Tailwind CSS
- TanStack Query (server state), Zustand (client state)
- Vite PWA Plugin + Workbox (offline support)

**Backend**
- Hono (Node.js web framework), TypeScript
- PostgreSQL + Drizzle ORM
- Redis + BullMQ (async job queue for content extraction)
- Google Gemini API (flashcard, quiz, summary, grading)
- Puppeteer + Mozilla Readability (web scraping & content extraction)

**Tooling**
- pnpm workspaces (monorepo), Docker Compose, TypeScript throughout

## Architecture

```
web2x/
├── apps/
│   ├── web/          # React + Vite frontend  (port 5173)
│   ├── api/          # Hono backend            (port 3001)
│   └── mlx/          # MLX inference server    (port 8001)
└── packages/
    └── shared/       # TypeScript types shared between apps
```

Article extraction runs asynchronously — the API queues a BullMQ job, a worker scrapes and processes the URL, and the frontend polls for status.

## Prerequisites

- Node.js 18+
- pnpm 9+
- Docker & Docker Compose (for PostgreSQL and Redis)
- Python 3.11+ (for the MLX inference server)
- Google Gemini API key ([get one here](https://aistudio.google.com/app/apikey))

### Docker Setup

The API requires PostgreSQL and Redis to be running before starting the dev server. Both are managed via Docker Compose.

```bash
# Verify Docker is installed and running
docker --version
docker compose version

# Start all services (PostgreSQL on 5433, Redis on 6379)
docker compose up -d

# Check services are healthy
docker compose ps

# View service logs if something looks wrong
docker compose logs redis
docker compose logs postgres

# Stop all services
docker compose down
```

> **Common error:** If you see `ECONNREFUSED` on port `6379` or `5433`, Docker services are not running. Run `docker compose up -d` to fix it.

### MLX Setup (optional)

The MLX app (`apps/mlx`) is a Python FastAPI server that runs local AI models for embeddings and chat. It requires an Apple Silicon Mac (MLX is Apple-only).

> **MLX is optional.** If the MLX server is not running, the API automatically falls back to Gemini for both chat responses and embeddings. All articles ingested while MLX is down are embedded with Gemini's `text-embedding-004` model and are only searchable via that model until re-indexed. If MLX comes back up, newly ingested articles switch back to MLX embeddings.

```bash
cd apps/mlx

# Create and activate a virtual environment (first time only)
python -m venv .venv
source .venv/bin/activate

# Install dependencies (first time only)
pip install -r requirements.txt

# Copy and configure environment variables (first time only)
cp .env.example .env
# Edit .env to set MLX_CHAT_MODEL and MLX_EMBED_MODEL if needed

# Start the MLX server
uvicorn main:app --reload --port 8001
```

The server starts on port `8001`. Verify it's running:

```bash
curl http://localhost:8001/health
```

> **Note:** MLX downloads model weights on first run — this can take several minutes depending on the model size. Models are cached locally after the first download.

## Getting Started

```bash
# 1. Clone the repo
git clone <repo-url>
cd web2x

# 2. Set up environment variables
cp apps/api/.env.example apps/api/.env.local
# Edit apps/api/.env.local and add your GEMINI_API_KEY

# 3. Start PostgreSQL and Redis
docker compose up -d

# 4. Install dependencies
pnpm install

# 5. Run database migrations
cd apps/api && pnpm db:migrate && cd ../..

# 6. Start the dev servers
pnpm dev
```

Open http://localhost:5173 in your browser.

## Environment Variables

All variables live in `apps/api/.env.local`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `GEMINI_MODEL` | No | `gemini-2.5-flash-lite-preview-06-17` | Gemini model to use |
| `DATABASE_URL` | Yes | `postgresql://postgres:password@localhost:5433/web2x_dev` | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `MLX_SERVICE_URL` | No | `http://localhost:8001` | MLX inference server URL (Gemini used as fallback if unreachable) |
| `API_PORT` | No | `3001` | Port for the API server |
| `API_BASE_URL` | No | `http://localhost:3001` | Public base URL of the API |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin |
| `PDF_STORAGE_DIR` | No | `uploads/pdfs` | Directory for generated PDFs |
| `NODE_ENV` | No | `development` | Node environment |

## Available Scripts

**Root (runs all workspaces in parallel):**

| Script | Description |
|---|---|
| `pnpm dev` | Start frontend + API dev servers |
| `pnpm build` | Build all workspaces |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm lint` | Lint all workspaces |

**Backend (`apps/api`):**

| Script | Description |
|---|---|
| `pnpm dev` | Start API with hot reload |
| `pnpm worker` | Run BullMQ extraction worker standalone |
| `pnpm db:generate` | Generate Drizzle migration files |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Open Drizzle Studio (DB GUI) |

## API Overview

| Method | Route | Description |
|---|---|---|
| `POST` | `/articles` | Submit a URL for extraction |
| `GET` | `/articles` | List recent articles |
| `GET` | `/articles/:id` | Get article + extraction status |
| `POST` | `/articles/:id/deck` | Generate flashcards |
| `GET` | `/articles/:id/summary` | Get AI summary |
| `POST` | `/articles/:id/quiz` | Generate quiz |
| `POST` | `/articles/:id/quiz/:qid/grade` | Grade a quiz answer |
| `POST` | `/articles/:id/pdf` | Generate PDF |
| `GET` | `/downloads/:filename` | Download generated PDF |
| `POST` | `/share-target` | Web Share API endpoint |
| `GET` | `/health` | Health check |

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss the approach.
