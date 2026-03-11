import { Clock, Code2, Loader2, Play, Sparkles } from 'lucide-react';
import type { LiveRunState } from '../../types';
import { MarkdownMessage } from '../../components/ui/markdown-message';

/* ─── Phase indicator banners ─── */

function InitializingBanner() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)]/40 bg-[var(--surface-soft)]/30 px-4 py-3">
      <Loader2 className="size-4 animate-spin text-[var(--accent)]" />
      <span className="text-[13px] font-medium text-[var(--text-secondary)]">Setting up workspace…</span>
    </div>
  );
}

function ThoughtBubble({ thought }: { thought: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)]/60">
        <Sparkles className="size-3 text-[var(--accent)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Thinking
        </div>
        <div className="rounded-xl border border-[var(--accent)]/15 bg-[var(--accent-soft)]/8 px-4 py-3">
          <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
            {thought}
          </p>
        </div>
      </div>
    </div>
  );
}

function CodingIndicator() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[var(--accent)]/20 bg-[var(--accent-soft)]/10 px-4 py-2.5">
      <Code2 className="size-3.5 text-[var(--accent)]" />
      <span className="text-[13px] font-medium text-[var(--accent)]">Generating code…</span>
      <span className="ml-auto inline-block size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
    </div>
  );
}

function ExecutingIndicator() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[var(--warning-border,var(--accent))]/20 bg-[var(--accent-soft)]/10 px-4 py-2.5">
      <Play className="size-3.5 text-[var(--accent)]" />
      <span className="text-[13px] font-medium text-[var(--accent)]">Running code…</span>
      <Loader2 className="ml-auto size-3.5 animate-spin text-[var(--accent)]" />
    </div>
  );
}

function WaitingNextTurnBanner() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[var(--border)]/40 bg-[var(--surface-soft)]/30 px-4 py-2.5">
      <Clock className="size-3.5 text-[var(--text-tertiary)]" />
      <span className="text-[13px] font-medium text-[var(--text-secondary)]">Analyzing results — preparing next step…</span>
      <Loader2 className="ml-auto size-3.5 animate-spin text-[var(--text-tertiary)]" />
    </div>
  );
}

/* ─── Main component ─── */

export function LiveAgentResponse({ liveRun }: { liveRun: LiveRunState }) {
  const { phase, thought, answerDraft, finalAnswer, status, completedSteps } = liveRun;
  const visibleAnswer = finalAnswer || answerDraft;

  return (
    <div data-live-run-response className="w-full space-y-3">
      {/* Phase: Initializing */}
      {phase === 'initializing' && !thought && completedSteps.length === 0 ? (
        <InitializingBanner />
      ) : null}

      {/* Thought bubble — show when agent is thinking */}
      {thought && (phase === 'thinking' || phase === 'initializing') ? (
        <ThoughtBubble thought={thought} />
      ) : null}

      {thought && (phase === 'coding' || phase === 'executing' || phase === 'waiting_next_turn') ? (
        <ThoughtBubble thought={thought} />
      ) : null}

      {/* Phase: Coding */}
      {phase === 'coding' ? <CodingIndicator /> : null}

      {/* Phase: Executing */}
      {phase === 'executing' ? <ExecutingIndicator /> : null}

      {/* Phase: Waiting for next turn */}
      {phase === 'waiting_next_turn' ? <WaitingNextTurnBanner /> : null}

      {/* Streaming answer */}
      {visibleAnswer ? (
        <div className="pt-1">
          <MarkdownMessage content={visibleAnswer} />
          {status === 'running' && phase === 'answering' ? (
            <div className="mt-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              Streaming
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
