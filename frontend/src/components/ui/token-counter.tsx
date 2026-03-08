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
        'inline-flex items-center rounded-full border border-[var(--border)]/70 bg-[var(--surface-soft)]/40 px-3 py-1.5 text-[11px] font-medium tracking-[0.02em] text-[var(--text-tertiary)]',
        className
      )}
    >
      <span>
        {current.toLocaleString()} / {max.toLocaleString()}
      </span>
    </div>
  );
}
