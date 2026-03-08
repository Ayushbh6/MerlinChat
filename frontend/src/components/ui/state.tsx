import { Bot, LoaderCircle, Sparkles, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Card } from './card';

export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 text-sm text-[var(--text-secondary)]', className)}>
      <LoaderCircle className="size-4 animate-spin" />
      <span>{label}...</span>
    </div>
  );
}

export function ErrorBanner({ message, className }: { message: string; className?: string }) {
  return (
    <Card className={cn('flex items-start gap-3 border-[var(--danger-border)] bg-[var(--danger-surface)] p-4 text-[var(--danger)]', className)}>
      <XCircle className="mt-0.5 size-4 shrink-0" />
      <span className="text-sm leading-6">{message}</span>
    </Card>
  );
}

export function SuccessBanner({ message, className }: { message: string; className?: string }) {
  return (
    <Card className={cn('flex items-start gap-3 border-[var(--success-border)] bg-[var(--success-surface)] p-4 text-[var(--success)]', className)}>
      <Sparkles className="mt-0.5 size-4 shrink-0" />
      <span className="text-sm leading-6">{message}</span>
    </Card>
  );
}

export function EmptyState({
  title,
  copy,
  className,
}: {
  title: string;
  copy: string;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col items-center gap-4 rounded-[32px] border-dashed bg-[var(--surface-soft)]/70 px-6 py-10 text-center', className)}>
      <div className="flex size-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
        <Bot className="size-5" />
      </div>
      <div className="space-y-2">
        <h3 className="font-heading text-xl font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="max-w-lg text-sm leading-6 text-[var(--text-secondary)]">{copy}</p>
      </div>
    </Card>
  );
}

export function PageTitle({
  eyebrow,
  title,
  copy,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  copy?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="space-y-3">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">{eyebrow}</p> : null}
        <div className="space-y-3">
          <h1 className="font-heading text-4xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-5xl">{title}</h1>
          {copy ? <p className="max-w-3xl text-sm leading-7 text-[var(--text-secondary)] sm:text-base">{copy}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}

