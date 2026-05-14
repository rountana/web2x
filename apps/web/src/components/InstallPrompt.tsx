import { useEffect, useState } from 'react';
import { useArticleStore } from '@/store/articleStore';
import { Button } from '@/components/ui/button';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const { articleCount, showInstallPrompt, setShowInstallPrompt } = useArticleStore();

  useEffect(() => {
    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (articleCount >= 2 && deferredPrompt) {
      setShowInstallPrompt(true);
    }
  }, [articleCount, deferredPrompt, setShowInstallPrompt]);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    }
  }

  if (!showInstallPrompt || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-24 left-0 right-0 flex justify-center px-4 z-50">
      <div className="bg-card border shadow-lg rounded-xl p-4 flex items-center gap-3 max-w-sm w-full">
        <Download className="h-5 w-5 text-primary shrink-0" />
        <p className="text-sm flex-1">Install web2x for offline access</p>
        <Button size="sm" onClick={handleInstall}>Install</Button>
        <button onClick={() => setShowInstallPrompt(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
