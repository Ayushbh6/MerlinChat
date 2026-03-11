import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  Check,
  FileStack,
  Loader2,
  PanelRightClose,
  TerminalSquare,
  X,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { oneDark, SyntaxHighlighter } from '../../lib/code-highlighter';
import { cn } from '../../lib/utils';
import type { LiveRunState, Run, RunStep } from '../../types';

type AnyStep = RunStep | NonNullable<LiveRunState['activeStep']>;
type ActivityTab = 'code' | 'output';

function statusVariant(status: string) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'accent';
  return 'default';
}

function StepStatusIcon({ step, isActive }: { step: AnyStep; isActive: boolean }) {
  if (isActive) return <Loader2 className="size-3.5 animate-spin text-[var(--accent)]" />;
  const exitCode = 'exit_code' in step ? step.exit_code : null;
  if (exitCode === 0) return <Check className="size-3.5 text-[var(--success)]" />;
  if (exitCode != null && exitCode !== 0) return <X className="size-3.5 text-[var(--danger)]" />;
  return <BrainCircuit className="size-3.5 text-[var(--text-tertiary)]" />;
}

function useBottomFollow<T extends HTMLElement>(depA: unknown, depB?: unknown) {
  const containerRef = useRef<T>(null);
  const followRef = useRef(true);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !followRef.current) return;
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
      frameRef.current = null;
    });

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [depA, depB]);

  const handleScroll = () => {
    const node = containerRef.current;
    if (!node) return;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  return { containerRef, handleScroll };
}

function CodeView({ content, streaming }: { content: string; streaming: boolean }) {
  const { containerRef, handleScroll } = useBottomFollow<HTMLDivElement>(content, streaming);

  if (streaming) {
    return (
      <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-auto px-6 py-5">
        <pre className="whitespace-pre-wrap font-mono text-[13px] leading-7 text-[var(--code-fg)]">
          {content || '# No code generated yet.'}
        </pre>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-auto">
      <SyntaxHighlighter
        language="python"
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '1.25rem 1.5rem',
          background: 'transparent',
          fontSize: '13px',
          lineHeight: '1.75',
          height: '100%',
          minHeight: '100%',
        }}
        PreTag="div"
        useInlineStyles
      >
        {content || '# No code generated yet.'}
      </SyntaxHighlighter>
    </div>
  );
}

function OutputView({ stdout, stderr }: { stdout: string; stderr: string }) {
  const { containerRef, handleScroll } = useBottomFollow<HTMLDivElement>(stdout, stderr);

  if (!stdout.trim() && !stderr.trim()) {
    return <div className="px-6 py-5 text-sm text-[var(--text-secondary)]">No execution output yet.</div>;
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-auto px-6 py-5">
      {stdout.trim() ? (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">stdout</div>
          <pre className="whitespace-pre-wrap text-[13px] leading-7 text-[var(--code-fg)]">{stdout}</pre>
        </div>
      ) : null}
      {stderr.trim() ? (
        <div className={stdout.trim() ? 'mt-6 space-y-2' : 'space-y-2'}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">stderr</div>
          <pre className="whitespace-pre-wrap text-[13px] leading-7 text-[var(--danger)]">{stderr}</pre>
        </div>
      ) : null}
    </div>
  );
}

function readStorageNumber(key: string) {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStorageActivityTab(key: string): ActivityTab {
  if (typeof window === 'undefined') return 'code';
  return window.localStorage.getItem(key) === 'output' ? 'output' : 'code';
}

export function ExecutionPanel({
  liveRun,
  fallbackRun,
  fallbackSteps,
  storageKey,
  onRequestClose,
}: {
  liveRun: LiveRunState | null;
  fallbackRun: Run | null;
  fallbackSteps: RunStep[];
  storageKey: string;
  onRequestClose?: () => void;
}) {
  const selectedStepKey = `${storageKey}:selected-step`;
  const activityTabKey = `${storageKey}:activity-view`;
  const [activityTab, setActivityTab] = useState<ActivityTab>(() => readStorageActivityTab(activityTabKey));
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(() => readStorageNumber(selectedStepKey));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(activityTabKey, activityTab);
  }, [activityTab, activityTabKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || selectedStepIndex == null) return;
    window.localStorage.setItem(selectedStepKey, String(selectedStepIndex));
  }, [selectedStepIndex, selectedStepKey]);

  const activeStep = liveRun?.activeStep || null;
  const allCompletedSteps = liveRun?.completedSteps.length ? liveRun.completedSteps : fallbackSteps;
  const status = liveRun?.status || fallbackRun?.status || 'idle';
  const phase = liveRun?.phase || 'done';
  const failureReason = liveRun?.failureReason || fallbackRun?.failure_reason || '';

  const allSteps: AnyStep[] = useMemo(() => {
    const steps: AnyStep[] = [...allCompletedSteps];
    if (activeStep && !steps.some(step => step.step_index === activeStep.step_index)) {
      steps.push(activeStep);
    }
    steps.sort((left, right) => left.step_index - right.step_index);
    return steps;
  }, [activeStep, allCompletedSteps]);

  const effectiveSelectedIndex = useMemo(() => {
    if (selectedStepIndex != null && allSteps.some(step => step.step_index === selectedStepIndex)) {
      return selectedStepIndex;
    }
    if (activeStep) return activeStep.step_index;
    return allSteps.length > 0 ? allSteps[allSteps.length - 1].step_index : null;
  }, [activeStep, allSteps, selectedStepIndex]);

  const currentStep = effectiveSelectedIndex != null
    ? allSteps.find(step => step.step_index === effectiveSelectedIndex) || allSteps[allSteps.length - 1] || null
    : null;

  const isCurrentStepActive = activeStep != null && currentStep?.step_index === activeStep.step_index;
  const thought = liveRun?.thought || currentStep?.thought || '';

  const phaseLabel = useMemo(() => {
    if (status === 'completed' || status === 'failed') return null;
    switch (phase) {
      case 'initializing': return 'Preparing workspace…';
      case 'thinking': return 'Reasoning…';
      case 'coding': return 'Generating code…';
      case 'executing': return 'Running code…';
      case 'waiting_next_turn': return 'Analyzing results…';
      case 'answering': return 'Writing response…';
      default: return null;
    }
  }, [phase, status]);

  function handleStepSelect(stepIndex: number) {
    setSelectedStepIndex(stepIndex);
    setActivityTab('code');
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[26px] border border-[var(--border)]/60 bg-[var(--surface)]/88 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)]/60 px-4 pb-3 pt-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">Workspace</p>
          <div className="flex items-center gap-2.5">
            <h2 className="font-heading text-[1.35rem] font-medium tracking-[-0.04em] text-[var(--text-primary)]">
              Workspace companion
            </h2>
            <Badge variant={statusVariant(status)}>{status}</Badge>
          </div>
          {thought && status === 'running' ? (
            <p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">{thought}</p>
          ) : null}
          {failureReason ? <p className="text-sm text-[var(--danger)]">{failureReason}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--text-tertiary)] sm:flex">
            {status === 'running' ? (
              <>
                <Loader2 className="size-4 animate-spin text-[var(--accent)]" />
                <span className="text-[var(--accent)]">Live</span>
              </>
            ) : (
              <>
                <Activity className="size-4" />
                Ready
              </>
            )}
          </div>
          {onRequestClose ? (
            <button
              type="button"
              onClick={onRequestClose}
              className="inline-flex size-9 items-center justify-center rounded-full text-[var(--text-tertiary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] lg:hidden"
              aria-label="Close workspace companion"
            >
              <PanelRightClose className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
          {phaseLabel ? (
            <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-[var(--accent-soft)]/15 px-3.5 py-2 text-[13px] text-[var(--accent)]">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="font-medium">{phaseLabel}</span>
            </div>
          ) : null}

          <div className="flex shrink-0 gap-2 overflow-x-auto pb-3">
            {allSteps.length === 0 && !activeStep ? (
              <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                <TerminalSquare className="size-4 text-[var(--accent)]" />
                {status === 'completed'
                  ? 'Assistant answered directly without code execution.'
                  : status === 'failed'
                    ? 'Run ended before any code step completed.'
                    : 'Waiting for the first code step.'}
              </div>
            ) : null}
            {allSteps.map(step => {
              const isActive = activeStep != null && step.step_index === activeStep.step_index;
              const isSelected = step.step_index === effectiveSelectedIndex;
              return (
                <button
                  key={step.step_index}
                  type="button"
                  onClick={() => handleStepSelect(step.step_index)}
                  className={cn(
                    'flex min-w-[8rem] items-center gap-3 rounded-full border px-3.5 py-2 text-left transition-all motion-reduce:transition-none',
                    isSelected
                      ? isActive
                        ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)]/25 ring-1 ring-[var(--accent)]/30'
                        : 'border-[var(--accent)]/40 bg-[var(--accent-soft)]/15 ring-1 ring-[var(--accent)]/20'
                      : 'border-[var(--border)]/70 hover:border-[var(--accent)]/45',
                  )}
                >
                  <div
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full',
                      isActive
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'bg-[var(--accent-soft)]/55 text-[var(--accent)]',
                    )}
                  >
                    <StepStatusIcon step={step} isActive={isActive} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">Step {step.step_index}</div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                      {isActive ? 'streaming' : ('exit_code' in step && step.exit_code != null)
                        ? step.exit_code === 0 ? 'success' : step.exit_code === 2 ? 'blocked' : `exit ${step.exit_code}`
                        : 'pending'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)]/40 bg-black/20">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--border)]/60 px-4 py-3">
              <div className="flex items-center gap-2">
                {(['code', 'output'] as const).map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setActivityTab(item)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors motion-reduce:transition-none',
                      activityTab === item
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    {item === 'code' ? 'Code' : 'Output'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                {isCurrentStepActive && activityTab === 'code' ? (
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)]">
                    <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                    Streaming
                  </span>
                ) : null}
                {currentStep?.artifacts?.length ? (
                  <div className="flex items-center gap-2 overflow-x-auto">
                    {currentStep.artifacts.map(artifact => (
                      <Badge key={`${currentStep.step_index}-${artifact.name}`} className="gap-1.5 normal-case tracking-normal">
                        <FileStack className="size-3.5" />
                        {artifact.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none">
              {activityTab === 'code' ? (
                <CodeView content={currentStep?.code || ''} streaming={isCurrentStepActive} />
              ) : (
                <OutputView stdout={currentStep?.stdout || ''} stderr={currentStep?.stderr || ''} />
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
