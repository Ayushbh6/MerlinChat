import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl border text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--accent)] text-[var(--accent-foreground)] shadow-lg shadow-[color:var(--accent-shadow)] hover:-translate-y-0.5 hover:brightness-105',
        secondary:
          'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
        ghost: 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]',
        outline: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
        danger:
          'border-transparent bg-[var(--danger)] text-white shadow-lg shadow-[color:var(--danger-shadow)] hover:-translate-y-0.5',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-9 rounded-xl px-3 text-xs',
        lg: 'h-12 px-5 text-sm',
        icon: 'size-10 rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

