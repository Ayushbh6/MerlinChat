import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GripVertical, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

interface WorkspaceSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  storageKey: string;
  mobileTrigger?: ReactNode;
}

const DEFAULT_RATIO = 0.52;
const MIN_RATIO = 0.30;
const MAX_RATIO = 0.72;

export function WorkspaceSplitPane({
  left,
  right,
  panelOpen,
  onPanelOpenChange,
  storageKey,
  mobileTrigger,
}: WorkspaceSplitPaneProps) {
  const ratioKey = `${storageKey}:ratio`;
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  const [ratio, setRatio] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_RATIO;
    const stored = window.localStorage.getItem(ratioKey);
    if (!stored) return DEFAULT_RATIO;
    const parsed = Number(stored);
    if (!Number.isFinite(parsed)) return DEFAULT_RATIO;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, parsed));
  });

  const desktopColumns = useMemo(() => {
    if (!panelOpen) return 'minmax(0,1fr)';
    const leftWidth = `${(ratio * 100).toFixed(2)}%`;
    return `${leftWidth} 14px minmax(22rem, 1fr)`;
  }, [panelOpen, ratio]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  function updateRatio(clientX: number, host: HTMLDivElement) {
    const bounds = host.getBoundingClientRect();
    const next = (clientX - bounds.left) / bounds.width;
    const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, next));
    setRatio(clamped);
    window.localStorage.setItem(ratioKey, String(clamped));
  }

  if (isDesktop) {
    return (
      <div className="min-h-0 flex-1 flex-col lg:flex">
        <div className="flex items-center justify-end px-4 pb-2 pt-0.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => onPanelOpenChange(!panelOpen)}>
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            {panelOpen ? 'Hide companion' : 'Show companion'}
          </Button>
        </div>
        <div
          className="grid min-h-0 flex-1 gap-0 px-4 pb-4 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none"
          style={{ gridTemplateColumns: desktopColumns }}
          ref={node => {
            if (!node || !panelOpen) return;

            const separator = node.querySelector<HTMLButtonElement>('[data-workspace-separator]');
            if (!separator) return;

            const handlePointerMove = (event: PointerEvent) => updateRatio(event.clientX, node);
            const handlePointerUp = () => {
              window.removeEventListener('pointermove', handlePointerMove);
              window.removeEventListener('pointerup', handlePointerUp);
            };

            separator.onpointerdown = event => {
              event.preventDefault();
              window.addEventListener('pointermove', handlePointerMove);
              window.addEventListener('pointerup', handlePointerUp);
            };
          }}
        >
          <div className="min-h-0 overflow-hidden">{left}</div>
          {panelOpen ? (
            <>
              <button
                type="button"
                data-workspace-separator
                aria-label="Resize workspace panels"
                className={cn(
                  'group flex min-h-0 cursor-col-resize items-center justify-center rounded-full',
                  'bg-transparent text-[var(--text-tertiary)] transition hover:text-[var(--accent)]'
                )}
                onKeyDown={event => {
                  if (event.key === 'ArrowLeft') {
                    const next = Math.max(MIN_RATIO, ratio - 0.03);
                    setRatio(next);
                    window.localStorage.setItem(ratioKey, String(next));
                  }
                  if (event.key === 'ArrowRight') {
                    const next = Math.min(MAX_RATIO, ratio + 0.03);
                    setRatio(next);
                    window.localStorage.setItem(ratioKey, String(next));
                  }
                }}
              >
                <span className="flex h-16 w-2 items-center justify-center rounded-full bg-[var(--border)] transition group-hover:bg-[var(--accent-soft)]">
                  <GripVertical className="size-4 rotate-90" />
                </span>
              </button>
              <div className="min-h-0 overflow-hidden border-l border-[var(--border)]/60 pl-4">{right}</div>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 lg:hidden">
      <div className="min-h-0 flex-1 overflow-hidden">{left}</div>
      {mobileTrigger ? <div className="shrink-0">{mobileTrigger}</div> : null}
      {panelOpen ? (
        <>
          <button
            type="button"
            aria-label="Close workspace companion overlay"
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={() => onPanelOpenChange(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 h-[70vh] rounded-t-[28px] border border-[var(--border)]/60 bg-[var(--surface-elevated)] shadow-[0_-18px_60px_rgba(15,23,42,0.28)] transition-transform duration-300 ease-out motion-reduce:transition-none">
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <div className="mx-auto h-1.5 w-14 rounded-full bg-[var(--border)]" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-3 top-2"
                onClick={() => onPanelOpenChange(false)}
                aria-label="Close workspace companion"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 h-[calc(70vh-2.5rem)] overflow-hidden px-4 pb-4">{right}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}
