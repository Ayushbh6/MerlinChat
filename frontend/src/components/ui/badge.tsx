import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]',
  {
    variants: {
      variant: {
        default: 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)]',
        accent: 'border-transparent bg-[var(--accent-soft)] text-[var(--accent)]',
        success: 'border-transparent bg-[var(--success-soft)] text-[var(--success)]',
        danger: 'border-transparent bg-[var(--danger-soft)] text-[var(--danger)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

