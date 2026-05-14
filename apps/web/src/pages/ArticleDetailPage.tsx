import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useArticle } from '@/hooks/useArticle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getAnonId, getWorkspaceId } from '@/lib/api';
import { useState } from 'react';
import { ArrowLeft, Layers, HelpCircle, FileText, Share2, Loader2, BookOpen, MessageSquare, AlertCircle, Trash2 } from 'lucide-react';

export function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: article, isLoading } = useArticle(id!);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const extractionFailed = article?.status === 'failed';

  async function handleDelete() {
    if (!id) return;
    if (!confirm(`Remove "${article?.title || 'this article'}" from your workspace? This cannot be undone.`)) return;
    setDeleteLoading(true);
    try {
      await api.articles.delete(id);
      navigate('/');
    } catch {
      setDeleteLoading(false);
    }
  }

  async function handlePdf() {
    if (!id) return;
    setPdfLoading(true);
    try {
      const { url } = await api.pdf.generate(id);
      window.open(url, '_blank');
    } catch {
      // silent fail
    } finally {
      setPdfLoading(false);
    }
  }

  if (isLoading || !article) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">
        <Skeleton className="h-7 w-3/4 mt-4 mb-2" />
        <Skeleton className="h-4 w-1/2 mb-6" />
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-4 w-full mb-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 bg-background/95 backdrop-blur border-b z-10">
        <div className="flex items-center gap-3 p-4 max-w-lg mx-auto">
          <button onClick={() => navigate('/')} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{article.sourceUrl}</p>
          </div>
          <Badge
            variant={
              article.status === 'ready'
                ? 'default'
                : article.status === 'failed'
                  ? 'destructive'
                  : 'secondary'
            }
          >
            {article.status}
          </Badge>
          <button
            onClick={handleDelete}
            disabled={deleteLoading}
            className="ml-1 p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
            title="Remove article"
          >
            {deleteLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      <main className="p-4 max-w-lg mx-auto">
        {extractionFailed && (
          <div className="flex items-start gap-3 p-3 mb-4 rounded-md bg-destructive/10 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Content extraction failed</p>
              <p className="text-xs mt-0.5 opacity-80">
                {article.errorMessage ?? 'Could not extract content. Learning features are unavailable.'}
              </p>
            </div>
          </div>
        )}
        <h1 className="text-xl font-bold mb-1">{article.title}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {article.wordCount.toLocaleString()} words
        </p>
        {!extractionFailed && (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown>{article.markdownContent}</ReactMarkdown>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-background border-t p-3 safe-bottom">
        <div className="flex gap-2 max-w-lg mx-auto">
          <Button
            variant="outline"
            className="flex-1 flex-col h-auto py-2 gap-1"
            onClick={() => navigate(`/articles/${id}/flashcards`)}
            disabled={extractionFailed}
          >
            <Layers className="h-4 w-4" />
            <span className="text-xs">Flashcards</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col h-auto py-2 gap-1"
            onClick={() => navigate(`/articles/${id}/quiz`)}
            disabled={extractionFailed}
          >
            <HelpCircle className="h-4 w-4" />
            <span className="text-xs">Quiz</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col h-auto py-2 gap-1"
            onClick={() => navigate(`/articles/${id}/summary`)}
            disabled={extractionFailed}
          >
            <Share2 className="h-4 w-4" />
            <span className="text-xs">Summary</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col h-auto py-2 gap-1"
            onClick={handlePdf}
            disabled={pdfLoading || extractionFailed}
          >
            {pdfLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            <span className="text-xs">PDF</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col h-auto py-2 gap-1"
            onClick={() => {
              const params = new URLSearchParams({ anonId: getAnonId(), workspaceId: getWorkspaceId() ?? '' });
              window.open(`/api/v1/articles/${id}/md?${params}`, '_blank');
            }}
            disabled={extractionFailed}
          >
            <BookOpen className="h-4 w-4" />
            <span className="text-xs">View .md</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col h-auto py-2 gap-1"
            onClick={() => navigate(`/chat?articleId=${id}`)}
            disabled={extractionFailed}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs">Chat</span>
          </Button>
        </div>
      </nav>
    </div>
  );
}
