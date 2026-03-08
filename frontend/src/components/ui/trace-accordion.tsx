import { useState } from 'react';
import { BrainCircuit, Check, ChevronDown, ChevronRight, FileStack, X } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Run, RunStep } from '../../types';
import { Badge } from './badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { cn } from '../../lib/utils';

function statusVariant(status: string) {
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'running') return 'accent';
  return 'default';
}

function StepStatusIcon({ exitCode }: { exitCode: number }) {
  if (exitCode === 0) return <Check className="size-3.5 text-[var(--success)]" />;
  return <X className="size-3.5 text-[var(--danger)]" />;
}

export function TraceAccordion({
  run,
  steps,
  open,
  onToggle,
}: {
  run: Run;
  steps: RunStep[];
  open: boolean;
  onToggle: () => void;
}) {
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<'code' | 'output'>('code');

  const currentStep = selectedStepIndex != null
    ? steps.find(s => s.step_index === selectedStepIndex) || steps[steps.length - 1] || null
    : steps[steps.length - 1] || null;

  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <div className="border-b border-[var(--border)]/60 pb-4">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 py-3 text-left transition hover:text-[var(--text-primary)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)]/60 text-[var(--accent)]">
              <BrainCircuit className="size-4" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {steps.length > 0 ? `${steps.length} step trace` : 'No code steps used'}
              </div>
              {run.failure_reason ? <p className="text-xs text-[var(--danger)]">{run.failure_reason}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
            {open ? <ChevronDown className="size-4 text-[var(--text-secondary)]" /> : <ChevronRight className="size-4 text-[var(--text-secondary)]" />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {steps.length === 0 ? (
            <div className="pt-4 text-sm text-[var(--text-secondary)]">
              The assistant answered directly without code execution.
            </div>
          ) : (
            <div className="space-y-4 pt-4">
              {/* Step selector pills */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {steps.map(step => {
                  const isSelected = step.step_index === (currentStep?.step_index ?? -1);
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => {
                        setSelectedStepIndex(step.step_index);
                        setTab('code');
                      }}
                      className={cn(
                        'flex min-w-[8rem] items-center gap-2.5 rounded-full border px-3.5 py-2 text-left transition-all',
                        isSelected
                          ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)]/15 ring-1 ring-[var(--accent)]/20'
                          : 'border-[var(--border)]/70 hover:border-[var(--accent)]/45',
                      )}
                    >
                      <div className={cn(
                        'flex size-7 items-center justify-center rounded-full',
                        step.exit_code === 0
                          ? 'bg-[var(--success)]/15 text-[var(--success)]'
                          : 'bg-[var(--danger)]/15 text-[var(--danger)]',
                      )}>
                        <StepStatusIcon exitCode={step.exit_code} />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-[var(--text-primary)]">Step {step.step_index}</div>
                        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                          {step.exit_code === 0 ? 'success' : step.exit_code === 2 ? 'blocked' : `exit ${step.exit_code}`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected step content */}
              {currentStep ? (
                <div className="space-y-3">
                  {currentStep.thought ? (
                    <p className="text-sm leading-7 text-[var(--text-secondary)]">{currentStep.thought}</p>
                  ) : null}

                  {/* Tabs */}
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
                    {currentStep.artifacts.length > 0 ? (
                      <div className="ml-auto flex items-center gap-2 overflow-x-auto">
                        {currentStep.artifacts.map(artifact => (
                          <Badge key={`${currentStep.id}-${artifact.name}`} variant="default" className="gap-1.5 normal-case tracking-normal">
                            <FileStack className="size-3.5" />
                            {artifact.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Content */}
                  {tab === 'code' ? (
                    <div className="overflow-hidden rounded-xl border border-[var(--border)]/40" style={{ background: 'var(--code-bg)' }}>
                      <SyntaxHighlighter
                        language="python"
                        style={oneDark}
                        customStyle={{
                          margin: 0,
                          padding: '1rem 1.25rem',
                          background: 'transparent',
                          fontSize: '13px',
                          lineHeight: '1.7',
                          maxHeight: '24rem',
                          overflow: 'auto',
                        }}
                        PreTag="div"
                        useInlineStyles
                      >
                        {currentStep.code || '# No code'}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-[var(--border)]/40 bg-black/20">
                      <div className="max-h-60 overflow-y-auto px-4 py-3">
                        {currentStep.stdout.trim() ? (
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">stdout</div>
                            <pre className="whitespace-pre-wrap text-[13px] leading-6 text-[var(--code-fg)]">{currentStep.stdout}</pre>
                          </div>
                        ) : null}
                        {currentStep.stderr.trim() ? (
                          <div className={currentStep.stdout.trim() ? 'mt-4 space-y-1.5' : 'space-y-1.5'}>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">stderr</div>
                            <pre className="whitespace-pre-wrap text-[13px] leading-6 text-[var(--danger)]">{currentStep.stderr}</pre>
                          </div>
                        ) : null}
                        {!currentStep.stdout.trim() && !currentStep.stderr.trim() ? (
                          <p className="text-sm text-[var(--text-secondary)]">No output.</p>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
