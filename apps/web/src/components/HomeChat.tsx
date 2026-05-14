import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChatInput } from '@/components/ChatInput';
import { cn } from '@/lib/utils';
import { getAnonId, getWorkspaceId, API_BASE } from '@/lib/api';
import type { ChatMessage, ChatSource } from '@web2x/shared';

export function HomeChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleQuery(query: string) {
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: query },
      { role: 'assistant', content: '' },
    ]);
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
        body: JSON.stringify({ query, history }),
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
      if (!res.body) throw new Error('No response body');

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
          if (line === '') { currentEvent = ''; continue; }
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); continue; }
          if (line.startsWith('data: ')) {
            const payload = line.slice(6);
            if (currentEvent === 'token' && payload) {
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
              } catch {}
            } else if (currentEvent === 'error') {
              throw new Error(payload);
            }
          }
        }
      }

      if (!gotToken) throw new Error('No response was generated. Please try again.');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
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

  const hasMessages = messages.length > 0;

  return (
    <div className="rounded-lg border overflow-hidden bg-background">
      {hasMessages && (
        <div className="max-h-80 overflow-y-auto p-4 space-y-4 border-b">
          {messages.map((msg, i) => (
            <HomeChatBubble key={i} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
      <ChatInput onSubmit={handleQuery} disabled={streaming} />
    </div>
  );
}

function HomeChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-1',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
        )}
      >
        {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
      </div>

      <div className={cn('max-w-[85%] space-y-1', isUser && 'items-end flex flex-col')}>
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm',
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
            <span className="inline-block w-1.5 h-3.5 bg-current animate-pulse rounded-sm" />
          )}
        </div>

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
