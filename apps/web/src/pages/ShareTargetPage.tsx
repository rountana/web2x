import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateArticle } from '@/hooks/useArticle';
import { Loader2 } from 'lucide-react';

export function ShareTargetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { mutateAsync: createArticle } = useCreateArticle();
  const called = useRef(false);

  useEffect(() => {
    const url = params.get('url');
    if (!url || called.current) return;
    called.current = true;

    createArticle(url)
      .then((article) => navigate(`/processing/${article.id}`, { replace: true }))
      .catch(() => navigate('/', { replace: true }));
  }, [params, createArticle, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
        <p className="text-muted-foreground">Saving article…</p>
      </div>
    </div>
  );
}
