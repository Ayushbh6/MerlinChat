import ReactMarkdown from 'react-markdown';
import { cn } from '../../lib/utils';

export function MarkdownMessage({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('markdown text-sm leading-7 text-[var(--text-primary)]', className)}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

