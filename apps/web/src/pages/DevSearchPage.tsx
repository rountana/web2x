import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Hash, Filter, Cpu, Wand2, Table2, Layers, Network, FlaskConical, Loader2, Upload, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { api, type CsvUploadSummary } from '@/lib/api';
import type { SearchResult } from '@web2x/shared';
import type { LucideIcon } from 'lucide-react';

interface Algorithm {
  id: string;
  shortName: string;
  fullName: string;
  icon: LucideIcon;
  description: string;
  capabilities: string[];
  examples: string[];
  live: boolean;
}

const ALGORITHMS: Algorithm[] = [
  {
    id: 'bm25',
    shortName: 'BM25',
    fullName: 'Keyword Search',
    icon: Hash,
    description: 'Exact phrase, fuzzy, or keyword match across article content using BM25 term-frequency ranking.',
    capabilities: ['exact phrase', 'fuzzy match', 'keyword ranking', 'boolean operators'],
    examples: ['who wrote the article', 'AI impact on SaaS companies'],
    live: true,
  },
  {
    id: 'metadata',
    shortName: 'Metadata',
    fullName: 'Metadata Index',
    icon: Filter,
    description: "Query by when, where, or how — not by content. Returns articles filtered by date or workspace metadata, ordered by recency.",
    capabilities: ['date filtering', 'temporal phrases', 'recency ranking', 'after:/before: syntax'],
    examples: ['articles from last week', 'past 30 days', 'after:2026-04-01'],
    live: true,
  },
  {
    id: 'vector',
    shortName: 'Vector',
    fullName: 'Vector Search',
    icon: Cpu,
    description: 'Surfaces top-N articles with vector proximity using cosine similarity / KNN over 768-dim embeddings.',
    capabilities: ['semantic similarity', 'cosine distance', 'KNN', 'top-N retrieval'],
    examples: ['AI impact on SaaS companies', 'distributed systems reliability'],
    live: true,
  },
  {
    id: 'rag',
    shortName: 'RAG',
    fullName: 'RAG',
    icon: Wand2,
    description: 'Retrieval-Augmented Generation — wraps any retriever (default: Hybrid) and surfaces the chunks that ground a generated answer in chat.',
    capabilities: ['composable retriever', 'context assembly', 'cited chunks', 'streamable in chat'],
    examples: ['explain what I read about embeddings', 'summarise the key takeaways on RAG'],
    live: true,
  },
  {
    id: 'csv',
    shortName: 'CSV',
    fullName: 'Structured Data',
    icon: Table2,
    description: 'Query uploaded CSV rows. Column-value patterns ("status = done", "price > 100") run as JSONB filters; remainder text runs through BM25.',
    capabilities: ['column = value', 'numeric ranges', 'JSONB filtering', 'BM25 on free text'],
    examples: ['status = done', 'priority = high meeting notes'],
    live: true,
  },
  {
    id: 'hybrid',
    shortName: 'Hybrid',
    fullName: 'Hybrid Search',
    icon: Layers,
    description: 'Combines BM25 keyword search and vector semantic search, fusing results with Reciprocal Rank Fusion (RRF) for broader recall.',
    capabilities: ['BM25 + Vector fusion', 'RRF ranking', 'parallel retrieval', 'best-of-both recall'],
    examples: ['AI impact on SaaS companies', 'recent articles on distributed systems'],
    live: true,
  },
  {
    id: 'kg',
    shortName: 'KG',
    fullName: 'Knowledge Graph',
    icon: Network,
    description: 'Grounds the LLM in deterministic graph data — best for relationship, provenance, and entity queries.',
    capabilities: ['entity linking', 'relationship traversal', 'deterministic grounding', 'graph queries'],
    examples: ['what connects author X to topic Y', 'show citation network for this article'],
    live: false,
  },
];

function CsvUploadsPanel() {
  const [uploads, setUploads] = useState<CsvUploadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const data = await api.csv.list();
      setUploads(data.uploads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load uploads');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.csv.upload(file);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(id: string, filename: string) {
    if (!confirm(`Delete "${filename}" and all its rows?`)) return;
    try {
      await api.csv.delete(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          CSV Uploads
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="h-7 text-xs"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Upload CSV
            </>
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : uploads.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No CSVs uploaded yet. Upload one to start querying.
        </p>
      ) : (
        <ul className="space-y-2">
          {uploads.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{u.filename}</p>
                <p className="text-[11px] text-muted-foreground">
                  {u.rowCount} row{u.rowCount === 1 ? '' : 's'} · {u.columnSchema.length} column
                  {u.columnSchema.length === 1 ? '' : 's'} ·{' '}
                  <span className="font-mono">
                    {u.columnSchema.map((c) => `${c.name}:${c.type}`).join(', ')}
                  </span>
                </p>
              </div>
              <button
                onClick={() => handleDelete(u.id, u.filename)}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1"
                title="Delete upload"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DevSearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(ALGORITHMS[0].id);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = ALGORITHMS.find((a) => a.id === selectedId) ?? ALGORITHMS[0];
  const Icon = selected.icon;
  const canRun = selected.live && query.trim().length > 0 && !loading;

  async function runSearch() {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await api.search.run({
        query: query.trim(),
        algorithm: selectedId as 'bm25' | 'vector' | 'hybrid' | 'rag' | 'csv' | 'metadata',
      });
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') runSearch();
  }

  function fillExample(example: string) {
    setQuery(example);
    setResults(null);
    setError(null);
    inputRef.current?.focus();
  }

  function handleAlgorithmSelect(id: string) {
    setSelectedId(id);
    setResults(null);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 bg-background/95 backdrop-blur border-b z-10">
        <div className="flex items-center gap-3 p-4 max-w-2xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <p className="font-semibold text-sm">Search Lab</p>
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
              DEV
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-6">
        {/* Search input */}
        <div className="space-y-1.5 pt-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                placeholder="Enter a search query…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setResults(null); setError(null); }}
                onKeyDown={handleKeyDown}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={runSearch}
              disabled={!canRun}
              title={!selected.live ? 'This algorithm is not yet implemented' : undefined}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run'}
            </Button>
          </div>
          {!selected.live && (
            <p className="text-xs text-muted-foreground pl-1">
              {selected.fullName} is not yet implemented — select BM25 or Vector to run a search.
            </p>
          )}
        </div>

        {/* Algorithm selector */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Algorithm
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {ALGORITHMS.map((algo) => {
              const AlgoIcon = algo.icon;
              const isActive = algo.id === selectedId;
              return (
                <button
                  key={algo.id}
                  onClick={() => handleAlgorithmSelect(algo.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium whitespace-nowrap transition-colors shrink-0',
                    isActive
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground hover:text-foreground border-input hover:border-foreground/30',
                    !algo.live && !isActive && 'opacity-50'
                  )}
                >
                  <AlgoIcon className="h-3.5 w-3.5" />
                  {algo.shortName}
                  {!algo.live && (
                    <span className="text-[10px] font-normal opacity-70">soon</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected algorithm detail */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">{selected.fullName}</p>
                {selected.live ? (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
                    LIVE
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border">
                    SOON
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                {selected.description}
              </p>
            </div>
          </div>

          {/* Capabilities */}
          <div className="flex flex-wrap gap-1.5">
            {selected.capabilities.map((cap) => (
              <Badge key={cap} variant="secondary" className="text-xs font-normal">
                {cap}
              </Badge>
            ))}
          </div>

          {/* Example queries */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Try an example:</p>
            <div className="flex flex-wrap gap-1.5">
              {selected.examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => fillExample(ex)}
                  className="text-xs px-2.5 py-1 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* CSV uploads panel — only shown when CSV algorithm is selected */}
        {selectedId === 'csv' && <CsvUploadsPanel />}

        {/* Results */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive font-medium">Search error</p>
            <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
          </div>
        )}

        {!loading && results !== null && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No results found</p>
            {selectedId === 'vector' && (
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                Vector search requires the MLX embedding service to be running. If it's down, results will be empty.
              </p>
            )}
            {selectedId === 'bm25' && (
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                No chunks matched. Try different keywords or check that articles have been chunked.
              </p>
            )}
            {selectedId === 'hybrid' && (
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                Hybrid ran BM25 + Vector in parallel and found no matches in either. Try a broader query or check that articles are chunked and the MLX service is running.
              </p>
            )}
            {selectedId === 'rag' && (
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                RAG delegated to Hybrid and found no grounding chunks. In production this triggers an "I couldn't find anything" answer in chat — here we just show the empty retrieval set.
              </p>
            )}
            {selectedId === 'csv' && (
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                No CSV rows matched. Upload a CSV below, then try a column-value query like <code className="font-mono">status = done</code> or free-text keywords from your data.
              </p>
            )}
            {selectedId === 'metadata' && (
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                No articles in this workspace match your filter. Try a wider window like <code className="font-mono">past 90 days</code>, or omit the temporal phrase to see your most recent articles.
              </p>
            )}
          </div>
        )}

        {!loading && results !== null && results.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {results.length} result{results.length !== 1 ? 's' : ''} · {selected.shortName}
            </p>
            {results.map((result, i) => (
              <div key={result.id} className="rounded-xl border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">
                      #{i + 1} · {result.source === 'csv' ? 'row' : 'chunk'} {result.id.slice(0, 8)}
                    </p>
                    <p className="text-sm font-medium leading-snug truncate">
                      {String(result.metadata.title ?? 'Untitled')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-xs font-mono font-semibold tabular-nums text-primary">
                      {Math.round(result.score * 100)}%
                    </span>
                    <div className="mt-1 w-12 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round(result.score * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
                  {result.content}
                </p>
              </div>
            ))}
          </div>
        )}

        {!loading && results === null && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {selected.live ? 'Enter a query and press Run' : 'Select a live algorithm to run a search'}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
              Results appear here — chunk content, article title, and relevance score.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
