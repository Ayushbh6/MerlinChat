import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getConversation, getConversationMessages, streamGeneralChat } from '../../api';
import { createClientId } from '../../app/helpers';
import type { GeneralChatRouteState } from '../../app/types';
import { Composer } from '../../components/ui/composer';
import { TokenCounter } from '../../components/ui/token-counter';
import { EmptyState, ErrorBanner, LoadingState } from '../../components/ui/state';
import { useMaxContextTokens } from '../../hooks/use-app-config';
import { MessageCard } from '../thread/message-card';
import type { Message } from '../../types';

export function GeneralChatPage({ onChatsUpdated }: { onChatsUpdated: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { conversationId = '' } = useParams();
  const routeState = (location.state as GeneralChatRouteState | null) ?? null;
  const autoSentRef = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const scrollTargetRef = useRef<string | null>(null);
  const followModeRef = useRef(true);
  const [conversationTitle, setConversationTitle] = useState('New Chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(true);
  const [thinking, setThinking] = useState('');
  const [currentTokenCount, setCurrentTokenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const maxContextTokens = useMaxContextTokens();

  const handleFeedScroll = useCallback(() => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    followModeRef.current = scrollHeight - scrollTop - clientHeight < 60;
  }, []);

  useEffect(() => {
    if (!feedRef.current) return;

    if (scrollTargetRef.current) {
      const id = scrollTargetRef.current;
      scrollTargetRef.current = null;
      const targetEl = feedRef.current.querySelector(`[data-msg-id="${id}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ block: 'start' });
        followModeRef.current = true;
        return;
      }
    }

    if (followModeRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, thinking, isSending]);

  const loadThread = useCallback(async () => {
    if (!conversationId) return;

    setLoading(true);
    setError(null);

    try {
      const [conversation, nextMessages] = await Promise.all([
        getConversation(conversationId),
        getConversationMessages(conversationId),
      ]);
      setConversationTitle(conversation.title);
      setCurrentTokenCount(typeof conversation.token_count === 'number' ? conversation.token_count : 0);
      setMessages(nextMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const sendMessage = useCallback(
    async (messageOverride?: string) => {
      const message = (messageOverride ?? input).trim();
      if (!message || isSending || !conversationId) return;

      const userId = createClientId('user');
      const assistantId = createClientId('assistant');

      scrollTargetRef.current = userId;
      setInput('');
      setThinking('');
      setIsSending(true);
      setError(null);
      setMessages(current => [
        ...current,
        { _id: userId, role: 'user', content: message, created_at: new Date().toISOString() },
        { _id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() },
      ]);

      try {
        await streamGeneralChat({
          conversationId,
          message,
          thinking: thinkingMode,
          onContent: chunk => {
            setMessages(current =>
              current.map(item => (item._id === assistantId ? { ...item, content: `${item.content}${chunk}` } : item))
            );
          },
          onThinking: chunk => {
            setThinking(current => `${current}${chunk}`);
          },
          onTokenCount: count => {
            setCurrentTokenCount(count);
          },
        });
        await Promise.all([loadThread(), onChatsUpdated()]);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Failed to send message';
        setError(detail);
        setMessages(current =>
          current.map(item => (item._id === assistantId ? { ...item, content: detail } : item))
        );
      } finally {
        setIsSending(false);
        setThinking('');
      }
    },
    [conversationId, input, isSending, loadThread, onChatsUpdated, thinkingMode]
  );

  useEffect(() => {
    if (!routeState?.initialPrompt || autoSentRef.current === routeState.initialPrompt || loading) return;
    autoSentRef.current = routeState.initialPrompt;
    void sendMessage(routeState.initialPrompt);
    navigate(location.pathname, { replace: true, state: null });
  }, [loading, location.pathname, navigate, routeState?.initialPrompt, sendMessage]);

  return (
    <section className="flex h-[calc(100vh-5.5rem)] min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[var(--border)]/50 bg-[var(--thread-header)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[52rem] items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <h1 className="truncate font-heading text-[1.55rem] font-medium tracking-[-0.035em] text-[var(--text-primary)]">
              {conversationTitle}
            </h1>
          </div>
          <TokenCounter current={currentTokenCount} max={maxContextTokens} />
        </div>
      </header>

      {error ? (
        <div className="shrink-0 border-b border-[var(--border)]/50 bg-[var(--thread-header)] px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-[52rem]">
            <ErrorBanner message={error} />
          </div>
        </div>
      ) : null}

      <div ref={feedRef} onScroll={handleFeedScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-7 px-4 py-8">
          {loading ? <LoadingState label="Loading conversation" className="py-6" /> : null}
          {!loading && messages.length === 0 ? (
            <EmptyState title="This chat is empty" copy="Send a message below to get the conversation started." />
          ) : null}
          {messages.map((message, index) => (
            <MessageCard
              key={message._id || `msg-${index}`}
              message={message}
              pending={isSending && index === messages.length - 1 && message.role === 'assistant'}
              activeThinking={
                isSending && index === messages.length - 1 && message.role === 'assistant' ? thinking : undefined
              }
            />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)]/50 bg-[var(--thread-footer)] backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[52rem] px-4 py-4">
          <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => void sendMessage()}
          placeholder="Ask anything..."
          disabled={loading || isSending}
          isLoading={isSending}
          thinkingMode={thinkingMode}
          onToggleThinking={() => setThinkingMode(current => !current)}
          showThinkingToggle
            variant="thread"
          />
        </div>
      </div>
    </section>
  );
}
