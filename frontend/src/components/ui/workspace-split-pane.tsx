import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GripVertical, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

interface WorkspaceSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  storageKey: string;
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
}: WorkspaceSplitPaneProps) {
  const ratioKey = `${storageKey}:ratio`;
  const [ratio, setRatio] = useState(DEFAULT_RATIO);

  useEffect(() => {
    const stored = window.localStorage.getItem(ratioKey);
    if (!stored) return;
    const parsed = Number(stored);
    if (Number.isFinite(parsed)) {
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, parsed)));
    }
  }, [ratioKey]);

  const desktopColumns = useMemo(() => {
    if (!panelOpen) return 'minmax(0,1fr)';
    const leftWidth = `${(ratio * 100).toFixed(2)}%`;
    return `${leftWidth} 14px minmax(22rem, 1fr)`;
  }, [panelOpen, ratio]);

  function updateRatio(clientX: number, host: HTMLDivElement) {
    const bounds = host.getBoundingClientRect();
    const next = (clientX - bounds.left) / bounds.width;
    const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, next));
    setRatio(clamped);
    window.localStorage.setItem(ratioKey, String(clamped));
  }

  return (
    <>
      <div className="hidden min-h-0 flex-1 lg:flex lg:flex-col">
        <div className="flex items-center justify-end px-6 pb-3 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onPanelOpenChange(!panelOpen)}>
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            {panelOpen ? 'Hide activity' : 'Show activity'}
          </Button>
        </div>
        <div
          className="grid min-h-0 flex-1 gap-0 px-6 pb-5"
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
              <div className="min-h-0 overflow-hidden border-l border-[var(--border)]/60 pl-6">{right}</div>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 lg:hidden">
        <div className="min-h-0 overflow-hidden">{left}</div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => onPanelOpenChange(!panelOpen)}>
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            {panelOpen ? 'Hide activity' : 'Show activity'}
          </Button>
        </div>
        {panelOpen ? <div className="min-h-0 overflow-hidden border-t border-[var(--border)]/60 pt-3">{right}</div> : null}
      </div>
    </>
  );
}
