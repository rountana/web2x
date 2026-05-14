import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuiz, useCreateQuiz, useGradeAnswer } from '@/hooks/useQuiz';
import type { QuizQuestion, GradeResponse } from '@web2x/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: quiz, isLoading, isError } = useQuiz(id!);
  const { mutate: createQuiz, isPending: isGenerating } = useCreateQuiz(id!);
  const { mutateAsync: gradeAnswer, isPending: isGrading } = useGradeAnswer(id!);

  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [openText, setOpenText] = useState('');
  const [gradeResult, setGradeResult] = useState<GradeResponse | null>(null);
  const [scores, setScores] = useState<boolean[]>([]);

  useEffect(() => {
    if (!isLoading && !quiz && !isError) createQuiz(5);
    if (isError) createQuiz(5);
  }, [isLoading, quiz, isError, createQuiz]);

  const questions = quiz?.questions ?? [];
  const question: QuizQuestion | undefined = questions[current];
  const isLast = current === questions.length - 1;
  const isDone = current >= questions.length && scores.length > 0;

  function handleMCSelect(option: string) {
    if (selected) return;
    setSelected(option);
    setScores((prev) => [...prev, option === question?.correctAnswer]);
  }

  async function handleOpenGrade() {
    if (!question || !openText.trim()) return;
    const result = await gradeAnswer({ questionId: question.id, userAnswer: openText });
    setGradeResult(result);
    setScores((prev) => [...prev, result.correct]);
  }

  function handleNext() {
    setSelected(null);
    setOpenText('');
    setGradeResult(null);
    setCurrent((c) => c + 1);
  }

  if (isLoading || isGenerating) {
    return (
      <div className="min-h-screen p-4 max-w-lg mx-auto">
        <Skeleton className="h-6 w-1/2 mt-4 mb-6" />
        <Skeleton className="h-24 w-full mb-4 rounded-xl" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full mb-2" />)}
      </div>
    );
  }

  if (isDone) {
    const correct = scores.filter(Boolean).length;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl font-bold text-primary mb-2">{correct}/{questions.length}</div>
          <p className="text-muted-foreground mb-6">Quiz complete!</p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate(-1)}>Back</Button>
            <Button onClick={() => { setCurrent(0); setScores([]); }}>Retry</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 p-4 border-b">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-semibold">Quiz</h1>
        <span className="ml-auto text-sm text-muted-foreground">
          {current + 1} / {questions.length}
        </span>
      </header>

      {question && (
        <main className="p-4 max-w-lg mx-auto">
          <div className="bg-card border rounded-xl p-4 mb-4">
            <Badge variant="secondary" className="mb-2 capitalize">
              {question.type.replace('_', ' ')}
            </Badge>
            <p className="font-medium">{question.question}</p>
          </div>

          {question.type === 'multiple_choice' && (
            <div className="space-y-2">
              {question.options.map((opt) => {
                const isCorrect = opt === question.correctAnswer;
                const isChosen = opt === selected;
                return (
                  <button
                    key={opt}
                    onClick={() => handleMCSelect(opt)}
                    disabled={!!selected}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-colors',
                      !selected && 'hover:bg-accent',
                      selected && isCorrect && 'bg-green-50 border-green-500 text-green-800',
                      selected && isChosen && !isCorrect && 'bg-red-50 border-red-500 text-red-800',
                      selected && !isChosen && !isCorrect && 'opacity-50',
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
              {selected && (
                <div className={cn(
                  'flex items-start gap-2 p-3 rounded-lg mt-2',
                  selected === question.correctAnswer ? 'bg-green-50' : 'bg-red-50',
                )}>
                  {selected === question.correctAnswer
                    ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                    : <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />}
                  <p className="text-sm">{question.explanation}</p>
                </div>
              )}
            </div>
          )}

          {question.type === 'open_ended' && (
            <div className="space-y-3">
              <textarea
                value={openText}
                onChange={(e) => setOpenText(e.target.value)}
                disabled={!!gradeResult}
                placeholder="Type your answer…"
                className="w-full border rounded-lg p-3 text-sm resize-none h-28 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {!gradeResult && (
                <Button
                  onClick={handleOpenGrade}
                  disabled={!openText.trim() || isGrading}
                  className="w-full"
                >
                  {isGrading ? 'Grading…' : 'Submit'}
                </Button>
              )}
              {gradeResult && (
                <div className={cn(
                  'flex items-start gap-2 p-3 rounded-lg',
                  gradeResult.correct ? 'bg-green-50' : 'bg-red-50',
                )}>
                  {gradeResult.correct
                    ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                    : <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />}
                  <div>
                    <p className="text-sm font-medium">Score: {gradeResult.score}/10</p>
                    <p className="text-sm">{gradeResult.feedback}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {((question.type === 'multiple_choice' && selected) ||
            (question.type === 'open_ended' && gradeResult)) && (
            <Button className="w-full mt-4" onClick={handleNext}>
              {isLast ? 'See results' : 'Next question'}
            </Button>
          )}
        </main>
      )}
    </div>
  );
}
