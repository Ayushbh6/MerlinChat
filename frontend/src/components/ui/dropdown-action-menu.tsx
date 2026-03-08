import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

export interface DropdownActionItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

export function DropdownActionMenu({ items, label = 'More actions' }: { items: DropdownActionItem[]; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} className="text-[var(--text-tertiary)]">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {items.map(item => (
          <DropdownMenuItem
            key={item.label}
            className={item.danger ? 'text-[var(--danger)] focus:text-[var(--danger)]' : undefined}
            onSelect={item.onSelect}
          >
            {item.icon}
            <span>{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
