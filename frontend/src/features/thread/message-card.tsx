import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Message } from '../../types';
import { MarkdownMessage } from '../../components/ui/markdown-message';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';

export function MessageCard({
  message,
  pending = false,
  activeThinking,
  variant = 'default',
}: {
  message: Message;
  pending?: boolean;
  activeThinking?: string;
  variant?: 'default' | 'workspace';
}) {
  const isAssistant = message.role === 'assistant';
  const isWorkspace = variant === 'workspace';

  return (
    <article
      data-msg-id={message._id}
      className={[
        'w-full',
        isAssistant
          ? isWorkspace
            ? 'max-w-none'
            : 'max-w-3xl'
          : isWorkspace
            ? 'ml-auto max-w-[min(46rem,78%)]'
            : 'ml-auto max-w-[min(44rem,78%)]',
        pending ? 'opacity-90' : '',
      ].join(' ')}
    >
      {isAssistant ? (
        <div className={isWorkspace ? 'space-y-5 pb-1' : 'space-y-4'}>
          {message.thinking ? <ThinkingBlock thinking={message.thinking} variant={variant} /> : null}
          {activeThinking ? <ThinkingBlock thinking={activeThinking} variant={variant} /> : null}
          <MarkdownMessage content={message.content || '...'} />
          {pending ? (
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Streaming</div>
          ) : null}
        </div>
      ) : (
        <div
          className={[
            'px-5 py-4 text-[var(--accent-foreground)]',
            isWorkspace
              ? 'rounded-2xl bg-black/35 shadow-[0_8px_24px_rgba(2,8,23,0.14)]'
              : 'rounded-2xl border border-[var(--user-bubble-border)] bg-[var(--user-bubble)] shadow-[0_8px_24px_rgba(2,8,23,0.14)]',
          ].join(' ')}
        >
          <MarkdownMessage
            content={message.content}
            className="[&_p]:text-white/92 [&_strong]:text-white [&_code]:bg-white/12 [&_blockquote]:border-white/18 [&_blockquote]:text-white/80"
          />
        </div>
      )}
    </article>
  );
}

function ThinkingBlock({
  thinking,
  variant = 'default',
}: {
  thinking: string;
  variant?: 'default' | 'workspace';
}) {
  if (variant === 'workspace') {
    return (
      <div className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
        <div className="mt-2 size-2.5 shrink-0 rounded-full bg-[var(--accent)]/80 shadow-[0_0_24px_rgba(96,165,250,0.45)]" />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">Thinking</div>
          <div className="mt-2">
            <MarkdownMessage content={thinking} className="text-[15px] leading-7 text-[var(--text-secondary)]" />
          </div>
        </div>
      </div>
    );
  }

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
