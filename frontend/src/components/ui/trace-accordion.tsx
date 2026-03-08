import { BrainCircuit, ChevronDown, ChevronRight, FileStack } from 'lucide-react';
import type { Run, RunStep } from '../../types';
import { Badge } from './badge';
import { Card } from './card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

function statusVariant(status: string) {
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'running') return 'accent';
  return 'default';
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
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[var(--surface-soft)]/70">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
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
        <CollapsibleContent className="border-t border-[var(--border)]">
          <div className="space-y-4 p-5">
            {steps.length === 0 ? (
              <Card className="rounded-3xl bg-[var(--surface-soft)] p-4 text-sm text-[var(--text-secondary)]">
                The assistant answered directly without code execution.
              </Card>
            ) : null}
            {steps.map(step => (
              <Card key={step.id} className="rounded-[24px] bg-[var(--surface-elevated)]/80 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-heading text-lg font-semibold text-[var(--text-primary)]">Step {step.step_index}</h3>
                  <Badge variant={step.exit_code === 0 ? 'success' : 'danger'}>
                    {step.exit_code === 0 ? 'success' : `exit ${step.exit_code}`}
                  </Badge>
                </div>
                {step.thought ? <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">{step.thought}</p> : null}
                <TraceBlock label="Generated code" content={step.code} />
                {step.stdout ? <TraceBlock label="stdout" content={step.stdout} /> : null}
                {step.stderr ? <TraceBlock label="stderr" content={step.stderr} /> : null}
                {step.artifacts.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {step.artifacts.map(artifact => (
                      <Badge key={`${step.id}-${artifact.name}`} variant="default" className="gap-1.5 normal-case tracking-normal">
                        <FileStack className="size-3.5" />
                        {artifact.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function TraceBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="mt-4 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{label}</div>
      <pre className="overflow-x-auto rounded-3xl border border-[var(--border)] bg-[var(--code-bg)] p-4 text-xs leading-6 text-[var(--code-fg)]">
        <code>{content}</code>
      </pre>
    </div>
  );
}

