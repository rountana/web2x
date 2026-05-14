import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSummary, useCreateSummary } from '@/hooks/useSummary';
import { useArticle } from '@/hooks/useArticle';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Share2, Check, AlertCircle } from 'lucide-react';
import { useState } from 'react';

export function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: article } = useArticle(id!);
  const { data: summary, isLoading, isError } = useSummary(id!);
  const { mutate: createSummary, isPending: isGenerating } = useCreateSummary(id!);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isLoading && !summary && !isError) createSummary();
    if (isError) createSummary();
  }, [isLoading, summary, isError, createSummary]);

  async function handleShare() {
    if (!summary || !article) return;
    const text = [
      article.title,
      '',
      'Key points:',
      ...summary.keyPoints.map((p) => `• ${p}`),
      '',
      summary.overview,
      '',
      article.sourceUrl,
    ].join('\n');

    if (navigator.share) {
      await navigator.share({ title: article.title, text });
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 p-4 border-b">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-semibold">Summary</h1>
      </header>

      <main className="p-4 max-w-lg mx-auto">
        {(isLoading || isGenerating) && !summary && (
          <div className="space-y-3 mt-4">
            <Skeleton className="h-5 w-1/3" />
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
            <Skeleton className="h-5 w-1/3 mt-4" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {summary && (
          <>
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Key Points
              </h2>
              <ul className="space-y-2">
                {summary.keyPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-primary font-bold shrink-0">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mb-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Overview
              </h2>
              <p className="text-sm leading-relaxed">{summary.overview}</p>
            </section>

            <Button className="w-full" onClick={handleShare}>
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-2" /> Copied!
                </>
              ) : (
                <>
                  <Share2 className="h-4 w-4 mr-2" /> Share
                </>
              )}
            </Button>
          </>
        )}

        {!isLoading && !isGenerating && !summary && (
          <div className="mt-16 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-4">Could not generate summary.</p>
            <Button onClick={() => createSummary()}>Retry</Button>
          </div>
        )}
      </main>
    </div>
  );
}
