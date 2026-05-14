import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDeck, useCreateDeck } from '@/hooks/useDeck';
import { CardDeck } from '@/components/CardDeck';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft, AlertCircle } from 'lucide-react';

export function FlashcardsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: deck, isLoading, isError } = useDeck(id!);
  const { mutate: createDeck, isPending: isGenerating } = useCreateDeck(id!);

  useEffect(() => {
    if (!isLoading && !deck && !isError) {
      createDeck(10);
    }
    if (isError) {
      createDeck(10);
    }
  }, [isLoading, deck, isError, createDeck]);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 p-4 border-b">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-semibold">Flashcards</h1>
        {deck && (
          <span className="ml-auto text-sm text-muted-foreground">{deck.cards.length} cards</span>
        )}
      </header>

      <main className="p-4 max-w-lg mx-auto">
        {(isLoading || isGenerating) && !deck && (
          <div className="mt-8 space-y-3">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {deck && <CardDeck cards={deck.cards} />}

        {!isLoading && !isGenerating && !deck && (
          <div className="mt-16 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-4">Could not generate flashcards.</p>
            <Button onClick={() => createDeck(10)}>Retry</Button>
          </div>
        )}
      </main>
    </div>
  );
}
