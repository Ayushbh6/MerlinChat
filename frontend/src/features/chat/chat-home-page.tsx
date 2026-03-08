import { startTransition, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createConversation } from '../../api';
import { conversationTitleFromPrompt, getGreeting } from '../../app/helpers';
import type { GeneralChatRouteState } from '../../app/types';
import { Composer } from '../../components/ui/composer';
import { ErrorBanner, PageTitle } from '../../components/ui/state';

export function ChatHomePage({ onChatsUpdated }: { onChatsUpdated: () => Promise<void> }) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [thinkingMode, setThinkingMode] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function handleStartChat() {
    if (!prompt.trim()) return;
    const initialPrompt = prompt.trim();

    setPrompt('');

    try {
      const conversation = await createConversation({ title: conversationTitleFromPrompt(initialPrompt) });
      await onChatsUpdated();

      startTransition(() => {
        navigate(`/chat/${conversation._id}`, {
          state: { initialPrompt } satisfies GeneralChatRouteState,
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start chat');
    }
  }

  return (
    <section className="flex min-h-[calc(100vh-6rem)] flex-col justify-center gap-10 py-8">
      {error ? <ErrorBanner message={error} /> : null}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <PageTitle
          eyebrow="Atlas AI"
          title={`${getGreeting()}. How can I help?`}
          copy="Ask anything. Atlas can reason through problems, write code, and use your project context when you need grounded answers."
        />
        <Composer
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleStartChat}
          placeholder="Ask anything..."
          thinkingMode={thinkingMode}
          onToggleThinking={() => setThinkingMode(current => !current)}
          showThinkingToggle
          centered
          autoFocus
        />
      </div>
    </section>
  );
}

