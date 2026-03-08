import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BrainCircuit, Check, FileStack, Loader2, TerminalSquare, X } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';
import type { LiveRunState, Run, RunStep } from '../../types';

type AnyStep = RunStep | NonNullable<LiveRunState['activeStep']>;

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

function CodeView({ content }: { content: string }) {
  const codeEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as code streams in
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom) {
      codeEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [content]);

  return (
    <div ref={containerRef} className="h-full overflow-auto">
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
      <div ref={codeEndRef} />
    </div>
  );
}

function OutputView({ stdout, stderr }: { stdout: string; stderr: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll as output streams
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [stdout, stderr]);

  if (!stdout.trim() && !stderr.trim()) {
    return <div className="px-6 py-5 text-sm text-[var(--text-secondary)]">No execution output yet.</div>;
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto px-6 py-5">
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
      <div ref={endRef} />
    </div>
  );
}

export function ExecutionPanel({
  liveRun,
  fallbackRun,
  fallbackSteps,
}: {
  liveRun: LiveRunState | null;
  fallbackRun: Run | null;
  fallbackSteps: RunStep[];
}) {
  const [tab, setTab] = useState<'code' | 'output'>('code');
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);

  const activeStep = liveRun?.activeStep || null;
  const allCompletedSteps = liveRun?.completedSteps.length ? liveRun.completedSteps : fallbackSteps;
  const status = liveRun?.status || fallbackRun?.status || 'idle';
  const phase = liveRun?.phase || 'done';
  const failureReason = liveRun?.failureReason || fallbackRun?.failure_reason || '';

  // Build the full step list (completed + optionally active)
  const allSteps: AnyStep[] = useMemo(() => {
    const steps: AnyStep[] = [...allCompletedSteps];
    if (activeStep && !steps.some(s => s.step_index === activeStep.step_index)) {
      steps.push(activeStep);
    }
    steps.sort((a, b) => a.step_index - b.step_index);
    return steps;
  }, [allCompletedSteps, activeStep]);

  // Auto-select the latest active step as it streams
  const prevActiveIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeStep) {
      if (prevActiveIndexRef.current !== activeStep.step_index) {
        setSelectedStepIndex(activeStep.step_index);
        setTab('code');
        prevActiveIndexRef.current = activeStep.step_index;
      }
    }
  }, [activeStep]);

  // If no step selected, default to latest
  const effectiveSelectedIndex = selectedStepIndex ?? (allSteps.length > 0 ? allSteps[allSteps.length - 1].step_index : null);
  const currentStep = effectiveSelectedIndex != null
    ? allSteps.find(s => s.step_index === effectiveSelectedIndex) || allSteps[allSteps.length - 1] || null
    : null;

  const isCurrentStepActive = activeStep != null && currentStep?.step_index === activeStep.step_index;

  const thought = liveRun?.thought || currentStep?.thought || '';

  // Phase descriptions for the header
  const phaseLabel = useMemo(() => {
    if (status === 'completed') return null;
    if (status === 'failed') return null;
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
    setTab('code');
  }

  return (
    <aside className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)]/60 pb-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">Execution</p>
          <div className="flex items-center gap-3">
            <h2 className="font-heading text-[1.65rem] font-medium tracking-[-0.04em] text-[var(--text-primary)]">Agent activity</h2>
            <Badge variant={statusVariant(status)}>{status}</Badge>
          </div>
          {thought && status === 'running' ? (
            <p className="max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">{thought}</p>
          ) : null}
          {failureReason ? <p className="text-sm text-[var(--danger)]">{failureReason}</p> : null}
        </div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-4">
        {/* Phase status bar */}
        {phaseLabel ? (
          <div className="mb-3 flex items-center gap-2.5 rounded-lg bg-[var(--accent-soft)]/15 px-4 py-2.5 text-[13px] text-[var(--accent)]">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="font-medium">{phaseLabel}</span>
          </div>
        ) : null}

        {/* Step pills */}
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-4">
          {allSteps.length === 0 && !activeStep ? (
            <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
              <TerminalSquare className="size-4 text-[var(--accent)]" />
              Waiting for the first code step.
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
                  'flex min-w-[8.5rem] items-center gap-3 rounded-full border px-4 py-2 text-left transition-all',
                  isSelected
                    ? isActive
                      ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)]/25 ring-1 ring-[var(--accent)]/30'
                      : 'border-[var(--accent)]/40 bg-[var(--accent-soft)]/15 ring-1 ring-[var(--accent)]/20'
                    : 'border-[var(--border)]/70 hover:border-[var(--accent)]/45',
                )}
              >
                <div className={cn(
                  'flex size-8 items-center justify-center rounded-full',
                  isActive
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'bg-[var(--accent-soft)]/55 text-[var(--accent)]',
                )}>
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

        {/* Code/Output viewer */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)]/40 bg-black/20">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--border)]/60 px-4 py-3">
            <div className="flex items-center gap-2">
              {(['code', 'output'] as const).map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition',
                    tab === item
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                  )}
                >
                  {item === 'code' ? 'Code' : 'Output'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {isCurrentStepActive && tab === 'code' ? (
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

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === 'code' ? (
              <CodeView content={currentStep?.code || ''} />
            ) : (
              <OutputView stdout={currentStep?.stdout || ''} stderr={currentStep?.stderr || ''} />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
