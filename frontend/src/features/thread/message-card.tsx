import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Message } from '../../types';
import { MarkdownMessage } from '../../components/ui/markdown-message';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';

export function MessageCard({
  message,
  pending = false,
  activeThinking,
}: {
  message: Message;
  pending?: boolean;
  activeThinking?: string;
}) {
  const isAssistant = message.role === 'assistant';

  return (
    <article
      data-msg-id={message._id}
      className={[
        'w-full',
        isAssistant ? 'max-w-3xl' : 'ml-auto max-w-[min(44rem,78%)]',
        pending ? 'opacity-90' : '',
      ].join(' ')}
    >
      {isAssistant ? (
        <div className="space-y-4">
          {message.thinking ? <ThinkingBlock thinking={message.thinking} /> : null}
          {activeThinking ? <ThinkingBlock thinking={activeThinking} /> : null}
          <MarkdownMessage content={message.content || '...'} />
          {pending ? (
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Streaming</div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[16px] border border-[var(--user-bubble-border)] bg-[var(--user-bubble)] px-5 py-4 text-[var(--accent-foreground)] shadow-[0_8px_24px_rgba(2,8,23,0.14)]">
          <MarkdownMessage
            content={message.content}
            className="[&_p]:text-white/92 [&_strong]:text-white [&_code]:bg-white/12 [&_blockquote]:border-white/18 [&_blockquote]:text-white/80"
          />
        </div>
      )}
    </article>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  return (
    <Collapsible defaultOpen>
      <div className="overflow-hidden rounded-[14px] bg-[var(--surface-soft)]/45">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-[var(--text-tertiary)] [&[data-state=open]_.chevron-down]:block [&[data-state=open]_.chevron-right]:hidden">
          <ChevronDown className="chevron-down size-4" />
          <ChevronRight className="chevron-right hidden size-4" />
          <span>Thought Process</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3 pt-1">
          <MarkdownMessage content={thinking} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
