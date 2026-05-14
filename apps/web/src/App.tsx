import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { HomePage } from '@/pages/HomePage';
import { ShareTargetPage } from '@/pages/ShareTargetPage';
import { ProcessingPage } from '@/pages/ProcessingPage';
import { ArticleDetailPage } from '@/pages/ArticleDetailPage';
import { FlashcardsPage } from '@/pages/FlashcardsPage';
import { QuizPage } from '@/pages/QuizPage';
import { SummaryPage } from '@/pages/SummaryPage';
import { ChatPage } from '@/pages/ChatPage';
import { DevSearchPage } from '@/pages/DevSearchPage';
import { InstallPrompt } from '@/components/InstallPrompt';
import { useBootstrapWorkspace } from '@/hooks/useWorkspace';

export default function App() {
  const { isBootstrapped } = useBootstrapWorkspace();

  if (!isBootstrapped) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/share-target" element={<ShareTargetPage />} />
        <Route path="/processing/:id" element={<ProcessingPage />} />
        <Route path="/articles/:id" element={<ArticleDetailPage />} />
        <Route path="/articles/:id/flashcards" element={<FlashcardsPage />} />
        <Route path="/articles/:id/quiz" element={<QuizPage />} />
        <Route path="/articles/:id/summary" element={<SummaryPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/dev/search" element={<DevSearchPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallPrompt />
    </>
  );
}
