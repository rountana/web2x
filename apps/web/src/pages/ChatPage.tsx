import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, Bot, User, Loader2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChatInput } from '@/components/ChatInput';
import { cn } from '@/lib/utils';
import { getAnonId, getWorkspaceId, API_BASE } from '@/lib/api';
import type { ChatMessage, ChatSource } from '@web2x/shared';
import { useArticle, useArticleChunkStatus } from '@/hooks/useArticle';

export function ChatPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scopedArticleId = searchParams.get('articleId') ?? undefined;
  const { data: chunkStatus } = useArticleChunkStatus(scopedArticleId ?? '');
  const { data: scopedArticle } = useArticle(scopedArticleId ?? '', chunkStatus?.count);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleQuery(query: string) {
    // Capture history before state mutation so it reflects the last completed turn.
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    const userMsg: ChatMessage = { role: 'user', content: query };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    scrollToBottom();

    try {
      const workspaceId = getWorkspaceId();
      const res = await fetch(`${API_BASE}/api/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-anon-id': getAnonId(),
          ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
        },
        body: JSON.stringify({ query, articleId: scopedArticleId, history }),
      });

      if (!res.ok) {
        let errMsg = `Chat request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string; code?: string };
          if (body.code === 'RATE_LIMIT' || body.code === 'LLM_RATE_LIMIT') {
            errMsg = 'Rate limit reached. Please wait a moment before trying again.';
          } else if (body.error) {
            errMsg = body.error;
          }
        } catch {}
        throw new Error(errMsg);
      }
      if (!res.body) throw new Error('Chat request returned no body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let currentEvent = '';
      let gotToken = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (line === '') {
            currentEvent = '';
            continue;
          }

          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data: ')) {
            const payload = line.slice(6);

            if (currentEvent === 'token') {
              if (payload) {
                gotToken = true;
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: last.content + payload };
                  }
                  return updated;
                });
                scrollToBottom();
              }
            } else if (currentEvent === 'sources') {
              try {
                const sources = JSON.parse(payload) as ChatSource[];
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, sources };
                  }
                  return updated;
                });
              } catch {
                // malformed sources payload — ignore
              }
            } else if (currentEvent === 'error') {
              throw new Error(payload);
            }
          }
        }
      }

      if (!gotToken) {
        throw new Error('No response was generated. Please try again.');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Sorry, something went wrong. Please try again.';
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: last.content ? `${last.content}\n\n_[${errMsg}]_` : errMsg,
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 bg-background/95 backdrop-blur border-b z-10 flex-shrink-0">
        <div className="flex items-center gap-3 p-4 max-w-2xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Chat with your content</p>
            {scopedArticleId && (
              <p className="text-xs text-muted-foreground truncate">
                {scopedArticle?.title ?? 'Loading…'}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* RAG readiness banner */}
      {scopedArticleId && scopedArticle?.status === 'pending' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/60 border-b text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          Article is still processing…
        </div>
      )}
      {scopedArticleId && scopedArticle?.status === 'ready' && chunkStatus?.count === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/60 border-b text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          Building search index — using full article text until ready
        </div>
      )}
      {scopedArticleId && scopedArticle?.status === 'failed' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Article processing failed — responses may be limited
        </div>
      )}

      {/* Message list */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm mt-16">
              <Bot className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>
                {scopedArticle
                  ? `Ask anything about "${scopedArticle.title}"`
                  : 'Ask anything about your uploaded articles.'}
              </p>
              <p className="mt-1 text-xs">Shift+Enter for new line · Enter to send</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input */}
      <div className="flex-shrink-0 max-w-2xl w-full mx-auto">
        <ChatInput onSubmit={handleQuery} disabled={streaming} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-1',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div className={cn('max-w-[80%] space-y-1', isUser && 'items-end flex flex-col')}>
        {/* Bubble */}
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-muted text-foreground rounded-tl-sm'
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : message.content ? (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-pre:my-1">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <span className="inline-block w-2 h-4 bg-current animate-pulse rounded-sm" />
          )}
        </div>

        {/* Source badges */}
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {message.sources.map((s) => (
              <Badge key={s.articleId} variant="outline" className="text-xs cursor-default">
                {s.title}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
