import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Message } from '../../types';
import { Card } from '../../components/ui/card';
import { MarkdownMessage } from '../../components/ui/markdown-message';
import { Badge } from '../../components/ui/badge';
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
    <Card
      data-msg-id={message._id}
      className={[
        'space-y-4 p-5 sm:p-6',
        isAssistant
          ? 'border-[var(--border)] bg-[var(--surface)]'
          : 'ml-auto w-full border-transparent bg-[var(--accent)] text-[var(--accent-foreground)] sm:max-w-[78%]',
        pending ? 'opacity-90' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <Badge variant={isAssistant ? 'default' : 'accent'} className={isAssistant ? undefined : 'bg-white/18 text-white'}>
          {isAssistant ? 'Assistant' : 'You'}
        </Badge>
        {pending ? <span className="text-xs uppercase tracking-[0.18em] text-current/70">Streaming</span> : null}
      </div>
      {isAssistant && message.thinking ? <ThinkingBlock thinking={message.thinking} /> : null}
      {activeThinking ? <ThinkingBlock thinking={activeThinking} /> : null}
      <MarkdownMessage
        content={message.content || (isAssistant ? '...' : '')}
        className={isAssistant ? undefined : '[&_p]:text-white/92 [&_strong]:text-white [&_code]:bg-white/12 [&_blockquote]:border-white/20 [&_blockquote]:text-white/80'}
      />
    </Card>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  return (
    <Collapsible defaultOpen>
      <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--surface-soft)]/80">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)] [&[data-state=open]_.chevron-down]:block [&[data-state=open]_.chevron-right]:hidden">
          <ChevronDown className="chevron-down size-4" />
          <ChevronRight className="chevron-right hidden size-4" />
          <span>Thought Process</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-[var(--border)] px-4 py-4">
          <MarkdownMessage content={thinking} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

