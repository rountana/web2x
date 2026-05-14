import { useState, useRef } from 'react';
import type { FlashCard } from '@web2x/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CheckCircle2, RotateCcw } from 'lucide-react';

const SWIPE_THRESHOLD = 60;

interface CardDeckProps {
  cards: FlashCard[];
}

export function CardDeck({ cards }: CardDeckProps) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [gotIt, setGotIt] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);

  const touchStartX = useRef<number | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;

    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    if (dx > 0) {
      markReview();
    } else {
      markGotIt();
    }
  }

  function markGotIt() {
    setGotIt((prev) => new Set([...prev, current]));
    advance();
  }

  function markReview() {
    if (current > 0) {
      setFlipped(false);
      setCurrent((c) => c - 1);
    }
  }

  function advance() {
    setFlipped(false);
    if (current + 1 >= cards.length) {
      setDone(true);
    } else {
      setCurrent((c) => c + 1);
    }
  }

  function restart() {
    setCurrent(0);
    setFlipped(false);
    setGotIt(new Set());
    setDone(false);
  }

  if (done) {
    const score = gotIt.size;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-4">
        <CheckCircle2 className="h-14 w-14 text-primary mb-4" />
        <p className="text-4xl font-bold mb-1">{score}/{cards.length}</p>
        <p className="text-muted-foreground mb-6">cards mastered</p>
        <Button onClick={restart} variant="outline">
          <RotateCcw className="h-4 w-4 mr-2" /> Restart
        </Button>
      </div>
    );
  }

  const card = cards[current];

  return (
    <div className="flex flex-col items-center mt-4">
      <p className="text-sm text-muted-foreground mb-4">
        {current + 1} / {cards.length}
      </p>

      {/* Card */}
      <div
        className="w-full max-w-sm perspective-1000 cursor-pointer"
        onClick={() => setFlipped((f) => !f)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ perspective: '1000px' }}
      >
        <div
          className={cn(
            'relative w-full h-48 transition-transform duration-500',
            flipped && '[transform:rotateY(180deg)]',
          )}
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 bg-card border-2 border-border rounded-xl p-6 flex items-center justify-center text-center backface-hidden shadow-sm"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-lg font-medium">{card.front}</p>
          </div>
          {/* Back */}
          <div
            className="absolute inset-0 bg-primary text-primary-foreground rounded-xl p-6 flex items-center justify-center text-center backface-hidden shadow-sm"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-base">{card.back}</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3">Tap to flip · Swipe left = Got it · Swipe right = Review</p>

      <div className="flex gap-3 mt-6 w-full max-w-sm">
        <Button variant="outline" className="flex-1" onClick={markReview}>
          Review again
        </Button>
        <Button className="flex-1" onClick={markGotIt}>
          Got it
        </Button>
      </div>
    </div>
  );
}
