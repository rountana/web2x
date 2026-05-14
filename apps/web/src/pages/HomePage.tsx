import { useState, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateArticle, useIngestMarkdown, useIngestPdf } from '@/hooks/useArticle';
import { useArticleList } from '@/hooks/useArticle';
import { Badge } from '@/components/ui/badge';
import { HomeChat } from '@/components/HomeChat';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { api } from '@/lib/api';
import { Loader2, BookOpen, Plus, X, Link2, FileText, FileUp, Clipboard, MessageSquare, FlaskConical, Trash2 } from 'lucide-react';

type Mode = 'link' | 'text' | 'pdf';

export function HomePage() {
  const [mode, setMode] = useState<Mode>('link');

  // Link mode state
  const [urls, setUrls] = useState<string[]>(['']);
  const [urlErrors, setUrlErrors] = useState<Record<number, string>>({});

  // Text/paste mode state
  const [pasteContent, setPasteContent] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [clipboardError, setClipboardError] = useState('');

  // PDF mode state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfError, setPdfError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { mutateAsync: createArticle } = useCreateArticle();
  const { mutateAsync: ingestMarkdown } = useIngestMarkdown();
  const { mutateAsync: ingestPdf } = useIngestPdf();
  const { data: articleList } = useArticleList();

  async function handleDeleteArticle(e: React.MouseEvent, articleId: string, title: string) {
    e.stopPropagation();
    if (!confirm(`Remove "${title || 'this article'}" from your workspace? This cannot be undone.`)) return;
    setDeletingIds((prev) => new Set(prev).add(articleId));
    setDeleteErrors((prev) => { const n = { ...prev }; delete n[articleId]; return n; });
    try {
      await api.articles.delete(articleId);
      await queryClient.invalidateQueries({ queryKey: ['articles'] });
    } catch (err) {
      setDeleteErrors((prev) => ({ ...prev, [articleId]: (err as Error).message }));
    } finally {
      setDeletingIds((prev) => { const n = new Set(prev); n.delete(articleId); return n; });
    }
  }

  // Link mode helpers
  const addUrl = () => setUrls((prev) => [...prev, '']);
  const updateUrl = (i: number, val: string) =>
    setUrls((prev) => prev.map((u, idx) => (idx === i ? val : u)));
  const removeUrl = (i: number) => setUrls((prev) => prev.filter((_, idx) => idx !== i));

  function switchMode(next: Mode) {
    setMode(next);
    setPasteError('');
    setClipboardError('');
    setPdfError('');
    setUrlErrors({});
  }

  async function handleClipboardPaste() {
    setClipboardError('');
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setClipboardError('Clipboard is empty');
        return;
      }
      setPasteContent(text);
    } catch {
      setClipboardError('Could not read clipboard — please allow clipboard access');
    }
  }

  async function handleLinkSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = urls.map((u) => u.trim()).filter(Boolean);
    if (!trimmed.length) return;

    setIsSubmitting(true);
    setUrlErrors({});

    const newErrors: Record<number, string> = {};
    let firstId: string | null = null;
    let successCount = 0;

    for (let i = 0; i < trimmed.length; i++) {
      try {
        const article = await createArticle(trimmed[i]);
        if (!firstId) firstId = article.id;
        successCount++;
      } catch (err) {
        newErrors[i] = (err as Error).message;
      }
    }

    setIsSubmitting(false);
    setUrlErrors(newErrors);

    if (successCount === 0) return;
    if (trimmed.length === 1 && firstId) {
      navigate(`/processing/${firstId}`);
    } else {
      setUrls(['']);
    }
  }

  async function handleTextSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pasteContent.trim()) return;
    setPasteError('');
    setIsSubmitting(true);
    try {
      const article = await ingestMarkdown({
        content: pasteContent.trim(),
        title: pasteTitle.trim() || undefined,
      });
      navigate(`/processing/${article.id}`);
    } catch (err) {
      setPasteError((err as Error).message);
      setIsSubmitting(false);
    }
  }

  async function handlePdfSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pdfFile) return;
    setPdfError('');
    setIsSubmitting(true);
    try {
      const article = await ingestPdf({
        file: pdfFile,
        title: pdfTitle.trim() || undefined,
      });
      navigate(`/processing/${article.id}`);
    } catch (err) {
      setPdfError((err as Error).message);
      setIsSubmitting(false);
    }
  }

  const validCount = urls.filter((u) => u.trim()).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="p-4 border-b flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">web2x</h1>
          <WorkspaceSwitcher />
        </div>
        <div className="flex items-center gap-2">
          {import.meta.env.DEV && (
            <button
              onClick={() => navigate('/dev/search')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors text-sm font-medium text-amber-700"
              title="Developer Search Lab"
            >
              <FlaskConical className="h-4 w-4" />
              Search Lab
            </button>
          )}
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border hover:bg-accent transition-colors text-sm font-medium"
            title="Chat with your content"
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-lg mx-auto w-full">
        <div className="mt-8 mb-6">
          <h2 className="text-2xl font-bold mb-2">Turn any article into</h2>
          <p className="text-muted-foreground">flashcards, quizzes, summaries & PDFs</p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg border p-1 mb-4 gap-1">
          <button
            type="button"
            onClick={() => switchMode('link')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'link'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            Link
          </button>
          <button
            type="button"
            onClick={() => switchMode('text')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'text'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Text
          </button>
          <button
            type="button"
            onClick={() => switchMode('pdf')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'pdf'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileUp className="h-3.5 w-3.5" />
            PDF
          </button>
        </div>

        {/* Link mode */}
        {mode === 'link' && (
          <form onSubmit={handleLinkSubmit} className="space-y-3">
            <div className="space-y-2">
              {urls.map((url, i) => (
                <div key={i}>
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      placeholder="https://example.com/article"
                      value={url}
                      onChange={(e) => updateUrl(i, e.target.value)}
                      disabled={isSubmitting}
                      className="flex-1"
                      required={i === 0}
                    />
                    {urls.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeUrl(i)}
                        disabled={isSubmitting}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {urlErrors[i] && (
                    <p className="text-sm text-destructive mt-1">{urlErrors[i]}</p>
                  )}
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addUrl}
              disabled={isSubmitting}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add another link
            </Button>

            <Button type="submit" disabled={isSubmitting || validCount === 0} className="w-full">
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : validCount > 1 ? (
                `Process ${validCount} links`
              ) : (
                'Process link'
              )}
            </Button>
          </form>
        )}

        {/* Text/paste mode */}
        {mode === 'text' && (
          <form onSubmit={handleTextSubmit} className="space-y-3">
            <Input
              type="text"
              placeholder="Title (optional — extracted from first heading if blank)"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              disabled={isSubmitting}
            />

            {pasteContent ? (
              <div className="rounded-md border bg-muted/40 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/60">
                  <span className="text-xs text-muted-foreground">
                    {pasteContent.length.toLocaleString()} characters
                  </span>
                  <button
                    type="button"
                    onClick={() => { setPasteContent(''); setPasteError(''); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    disabled={isSubmitting}
                  >
                    Clear
                  </button>
                </div>
                <pre className="px-3 py-2 text-sm whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-sans">
                  {pasteContent.slice(0, 600)}{pasteContent.length > 600 ? '…' : ''}
                </pre>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleClipboardPaste}
                  disabled={isSubmitting}
                  className="w-full flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-input p-8 hover:border-primary hover:bg-accent/40 transition-colors disabled:opacity-50"
                >
                  <Clipboard className="h-7 w-7 text-muted-foreground" />
                  <span className="text-sm font-medium">Paste from clipboard</span>
                  <span className="text-xs text-muted-foreground">Reads whatever is currently copied</span>
                </button>
                {clipboardError && (
                  <p className="text-sm text-destructive">{clipboardError}</p>
                )}
              </div>
            )}

            {pasteError && <p className="text-sm text-destructive">{pasteError}</p>}
            <Button
              type="submit"
              disabled={isSubmitting || !pasteContent.trim()}
              className="w-full"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Process text'}
            </Button>
          </form>
        )}

        {/* PDF upload mode */}
        {mode === 'pdf' && (
          <form onSubmit={handlePdfSubmit} className="space-y-3">
            <Input
              type="text"
              placeholder="Title (optional — uses filename if blank)"
              value={pdfTitle}
              onChange={(e) => setPdfTitle(e.target.value)}
              disabled={isSubmitting}
            />
            <div
              className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-input p-8 cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-8 w-8 text-muted-foreground mb-2" />
              {pdfFile ? (
                <p className="text-sm font-medium">{pdfFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select a PDF file</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setPdfFile(f);
                  if (f && !pdfTitle) setPdfTitle(f.name.replace(/\.pdf$/i, ''));
                }}
              />
            </div>
            {pdfError && <p className="text-sm text-destructive">{pdfError}</p>}
            <Button type="submit" disabled={isSubmitting || !pdfFile} className="w-full">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Process PDF'}
            </Button>
          </form>
        )}

        <section className="mt-8">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Ask your library</h3>
          <HomeChat />
        </section>

        {articleList?.articles && articleList.articles.length > 0 && (
          <section className="mt-8">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Recent articles</h3>
            <ul className="space-y-2">
              {articleList.articles.map((a) => (
                <li key={a.id}>
                  <div className="group flex items-stretch rounded-lg border hover:bg-accent transition-colors overflow-hidden">
                    <button
                      onClick={() => navigate(`/articles/${a.id}`)}
                      className="flex-1 text-left p-3 min-w-0"
                      disabled={deletingIds.has(a.id)}
                    >
                      <div className="flex items-start gap-2">
                        <BookOpen className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{a.title || a.sourceUrl}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant={
                                a.status === 'ready'
                                  ? 'default'
                                  : a.status === 'failed'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                              className="text-xs"
                            >
                              {a.status}
                            </Badge>
                            {a.wordCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {a.wordCount.toLocaleString()} words
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteArticle(e, a.id, a.title)}
                      disabled={deletingIds.has(a.id)}
                      className="px-3 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 flex items-center"
                      title="Remove article"
                    >
                      {deletingIds.has(a.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  {deleteErrors[a.id] && (
                    <p className="text-xs text-destructive mt-1 px-1">{deleteErrors[a.id]}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
