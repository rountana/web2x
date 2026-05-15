import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useArticle, useArticleChunkStatus, useRetryArticle } from '@/hooks/useArticle';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STALL_THRESHOLD_MS = 60_000;

export function ProcessingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: chunkStatus } = useArticleChunkStatus(id!);
  const { data: article, error } = useArticle(id!, chunkStatus?.count);
  const { mutate: retry, isPending: retryPending, error: retryError } = useRetryArticle();
  const [stalled, setStalled] = useState(false);

  const chunkCount = chunkStatus?.count ?? 0;
  const isExtracting = !article || article.status === 'pending';
  const isIndexing = article?.status === 'ready' && chunkCount === 0;

  useEffect(() => {
    if (article?.status === 'ready' && chunkCount > 0) {
      navigate(`/articles/${id}`, { replace: true });
    }
  }, [article?.status, chunkCount, id, navigate]);

  useEffect(() => {
    if (!isExtracting) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), STALL_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [isExtracting, id]);

  if (article?.status === 'failed' || error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h2 className="font-semibold mb-1">Processing failed</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {article?.errorMessage ?? 'Could not extract content from this source.'}
          </p>
          {retryError && (
            <p className="text-xs text-destructive mb-3">{(retryError as Error).message}</p>
          )}
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              onClick={() => id && retry(id)}
              disabled={retryPending}
            >
              {retryPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Retry'}
            </Button>
            <Button onClick={() => navigate('/')}>Try another</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 max-w-lg mx-auto">
      <div className="mt-8">
        <Skeleton className="h-7 w-3/4 mb-2" />
        <Skeleton className="h-4 w-1/2 mb-6" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-5/6 mb-2" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-4/5 mb-6" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-3/4" />
      </div>

      <div className="flex flex-col items-center gap-3 mt-8">
        <div className="flex items-center gap-4 text-sm">
          <Step active={isExtracting} done={isIndexing} label="Extracting text" />
          <div className="h-px w-8 bg-border" />
          <Step active={isIndexing} label="Building search index" />
        </div>
        <p className="text-xs text-muted-foreground">
          {isIndexing ? 'Building search index…' : 'Extracting article…'}
        </p>
        {stalled && isExtracting && (
          <div className="mt-4 text-center">
            <p className="text-xs text-muted-foreground mb-2">
              Taking longer than expected. The source may be slow or blocking us.
            </p>
            {retryError && (
              <p className="text-xs text-destructive mb-2">{(retryError as Error).message}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => id && retry(id)}
              disabled={retryPending}
            >
              {retryPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Retry extraction
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ done = false, active = false, label }: { done?: boolean; active?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {active ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      ) : (
        <div
          className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${
            done ? 'bg-primary border-primary' : 'border-muted-foreground'
          }`}
        >
          {done && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
        </div>
      )}
      <span className={active ? 'text-foreground font-medium' : done ? 'text-muted-foreground' : 'text-muted-foreground'}>
        {label}
      </span>
    </div>
  );
}
