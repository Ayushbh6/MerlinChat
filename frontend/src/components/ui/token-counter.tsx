import { Cpu } from 'lucide-react';
import { cn } from '../../lib/utils';

export function TokenCounter({
  current,
  max,
  className,
}: {
  current: number;
  max: number;
  className?: string;
}) {
  return (
    <div
      title="Tokens used in current context"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-xs font-medium tracking-[0.04em] text-[var(--text-secondary)]',
        className
      )}
    >
      <Cpu className="size-3.5" />
      <span>
        {current.toLocaleString()} / {max.toLocaleString()}
      </span>
    </div>
  );
}

