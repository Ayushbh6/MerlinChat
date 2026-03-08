import { useEffect, useRef } from 'react';
import { Lightbulb, LoaderCircle, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  placeholder: string;
  disabled?: boolean;
  isLoading?: boolean;
  thinkingMode?: boolean;
  onToggleThinking?: () => void;
  showThinkingToggle?: boolean;
  centered?: boolean;
  autoFocus?: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  isLoading = false,
  thinkingMode = false,
  onToggleThinking,
  showThinkingToggle = false,
  centered = false,
  autoFocus = false,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [value]);

  return (
    <div className={cn('w-full', centered ? 'mx-auto max-w-4xl' : '')}>
      <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)]/95 p-3 shadow-[0_24px_70px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          className="max-h-80 min-h-28 w-full resize-none bg-transparent px-3 py-3 text-sm leading-7 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-2 pt-3">
          {showThinkingToggle ? (
            <Button
              type="button"
              size="sm"
              variant={thinkingMode ? 'default' : 'secondary'}
              disabled={disabled}
              onClick={onToggleThinking}
            >
              <Lightbulb className="size-3.5" />
              <span>Think</span>
            </Button>
          ) : (
            <div />
          )}
          <Button
            type="button"
            size="icon"
            aria-label="Send message"
            disabled={disabled || !value.trim()}
            onClick={() => void onSubmit()}
          >
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
