import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, PanelRightOpen } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createWorkspaceRun,
  loadWorkspaceThread,
  startWorkspaceRun,
  streamWorkspaceRunEvents,
  timelineForWorkspaceThread,
} from '../../api';
import type { WorkspaceRouteState } from '../../app/types';
import { Button } from '../../components/ui/button';
import { Composer } from '../../components/ui/composer';
import { WorkspaceSplitPane } from '../../components/ui/workspace-split-pane';
import { TraceAccordion } from '../../components/ui/trace-accordion';
import { TokenCounter } from '../../components/ui/token-counter';
import { EmptyState, ErrorBanner, LoadingState } from '../../components/ui/state';
import { useMaxContextTokens } from '../../hooks/use-app-config';
import type { LiveRunHandoffState, LiveRunState, PendingWorkspaceRun, RunEvent, ThreadState } from '../../types';
import { MessageCard } from '../thread/message-card';
import { ExecutionPanel } from './execution-panel';
import { LiveAgentResponse } from './live-agent-response';
import { applyRunEvent, createLiveRunState } from './live-run';
import { useWorkspaceResources } from './use-workspace-resources';

function isDesktopViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
}

const IMMEDIATE_FLUSH_EVENTS = new Set<RunEvent['type']>([
  'answer.delta',
  'answer.reset',
  'step.completed',
  'turn.completed',
  'turn.failed',
]);

function readStoredBoolean(key: string, fallback = false) {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(key);
  if (value == null) return fallback;
  return value === 'true';
}

function hasCanonicalAssistant(thread: ThreadState, reference: LiveRunHandoffState) {
  return thread.turns.some(turn => {
    const sameRun = turn.run?.id === reference.runId;
    const sameTurn = reference.turnId ? turn.id === reference.turnId : false;
    return (sameRun || sameTurn) && Boolean(turn.assistant_message);
  });
}

export function WorkspaceChatPage({ onWorkspaceUpdated }: { onWorkspaceUpdated: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId = '', conversationId = '' } = useParams();
  const panelStorageKey = `workspace-chat:${workspaceId}:${conversationId}`;
  const panelOpenKey = `${panelStorageKey}:panel-open`;
  const routeState = (location.state as WorkspaceRouteState | null) ?? null;
  const pendingRunFromRoute = routeState?.pendingRun;
  const pendingRunHandled = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const scrollTargetRef = useRef<string | null>(null);
  const followModeRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingRunIdRef = useRef<string | null>(null);
  const pendingEventsRef = useRef<RunEvent[]>([]);
  const pendingRunIdRef = useRef<string | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const liveRunRef = useRef<LiveRunState | null>(null);
  const { state: workspaceState, refresh: refreshWorkspace } = useWorkspaceResources(workspaceId, onWorkspaceUpdated);
  const [thread, setThread] = useState<ThreadState>({ turns: [], runSteps: {} });
  const [loadingThread, setLoadingThread] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pendingRun, setPendingRun] = useState<PendingWorkspaceRun | null>(pendingRunFromRoute || null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null);
  const [liveRunHandoff, setLiveRunHandoff] = useState<LiveRunHandoffState | null>(null);
  const [executionPanelOpen, setExecutionPanelOpen] = useState(() => readStoredBoolean(panelOpenKey, false));
  const [executionPanelDismissedRunId, setExecutionPanelDismissedRunId] = useState<string | null>(null);
  const maxContextTokens = useMaxContextTokens();

  const activeRunFromThread = useMemo(
    () =>
      thread.turns
        .map(turn => turn.run)
        .find(run => run && (run.status === 'queued' || run.status === 'running')) || null,
    [thread.turns]
  );

  const handleFeedScroll = useCallback(() => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    followModeRef.current = scrollHeight - scrollTop - clientHeight < 60;
  }, []);

  useEffect(() => {
    liveRunRef.current = liveRun;
  }, [liveRun]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(panelOpenKey, String(executionPanelOpen));
  }, [executionPanelOpen, panelOpenKey]);

  useEffect(() => {
    setExecutionPanelOpen(readStoredBoolean(panelOpenKey, false));
  }, [panelOpenKey]);

  useEffect(() => {
    if (!feedRef.current) return;

    if (scrollTargetRef.current) {
      const id = scrollTargetRef.current;
      scrollTargetRef.current = null;
      const targetEl = feedRef.current.querySelector(`[data-msg-id="${id}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ block: 'start' });
        followModeRef.current = true;
        return;
      }
    }

    if (followModeRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [thread, pendingRun, loadingThread, liveRun]);

  const loadThread = useCallback(async () => {
    if (!conversationId) return;
    setLoadingThread(true);
    setThreadError(null);

    try {
      const next = await loadWorkspaceThread(conversationId);
      setThread(next);
      return next;
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to load workspace chat');
      return null;
    } finally {
      setLoadingThread(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const autoOpenExecutionPanelForRun = useCallback((runId: string) => {
    if (!isDesktopViewport()) return;
    if (executionPanelDismissedRunId === runId) return;
    setExecutionPanelOpen(true);
  }, [executionPanelDismissedRunId]);

  const flushPendingEvents = useCallback((runId?: string) => {
    const targetRunId = runId || pendingRunIdRef.current;
    if (!targetRunId || pendingEventsRef.current.length === 0) return;

    const events = pendingEventsRef.current;
    pendingEventsRef.current = [];
    pendingRunIdRef.current = targetRunId;

    setLiveRun(current => {
      let next = current ?? createLiveRunState(targetRunId);
      for (const event of events) {
        next = applyRunEvent(next, event);
      }
      liveRunRef.current = next;
      return next;
    });
  }, []);

  const cancelPendingFlush = useCallback(() => {
    if (flushFrameRef.current != null) {
      cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = null;
    }
  }, []);

  const scheduleEventFlush = useCallback((runId: string, immediate = false) => {
    pendingRunIdRef.current = runId;
    if (immediate) {
      cancelPendingFlush();
      flushPendingEvents(runId);
      return;
    }

    if (flushFrameRef.current != null) return;
    flushFrameRef.current = requestAnimationFrame(() => {
      flushFrameRef.current = null;
      flushPendingEvents(runId);
    });
  }, [cancelPendingFlush, flushPendingEvents]);

  const streamWorkspaceTurn = useCallback(
    async (runId: string, userMessage: string, startRequested: boolean) => {
      streamAbortRef.current?.abort();
      cancelPendingFlush();
      pendingEventsRef.current = [];
      pendingRunIdRef.current = runId;
      const controller = new AbortController();
      streamAbortRef.current = controller;
      streamingRunIdRef.current = runId;
      scrollTargetRef.current = 'pending-user-msg';
      setExecutionPanelDismissedRunId(current => (current === runId ? current : null));
      autoOpenExecutionPanelForRun(runId);
      setPendingRun({ runId, userMessage });
      setThreadError(null);
      setLiveRunHandoff(null);
      const nextLiveRun = createLiveRunState(runId);
      liveRunRef.current = nextLiveRun;
      setLiveRun(nextLiveRun);

      try {
        const streamPromise = streamWorkspaceRunEvents({
          runId,
          signal: controller.signal,
          onEvent: event => {
            pendingEventsRef.current.push(event);
            scheduleEventFlush(runId, IMMEDIATE_FLUSH_EVENTS.has(event.type));
          },
        });

        if (startRequested) {
          await startWorkspaceRun(runId);
        }

        await streamPromise;
        flushPendingEvents(runId);

        await refreshWorkspace();
        const nextThread = await loadThread();
        setPendingRun(null);
        const settledLiveRun = liveRunRef.current;
        const needsHandoff = Boolean(
          nextThread &&
          settledLiveRun &&
          settledLiveRun.runId === runId &&
          settledLiveRun.status === 'completed' &&
          !hasCanonicalAssistant(nextThread, {
            runId,
            turnId: settledLiveRun.turnId ?? null,
          })
        );
        if (needsHandoff && settledLiveRun) {
          setLiveRunHandoff({ runId, turnId: settledLiveRun.turnId ?? null });
        } else {
          setLiveRunHandoff(null);
          liveRunRef.current = null;
          setLiveRun(null);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        flushPendingEvents(runId);
        setThreadError(err instanceof Error ? err.message : 'Workspace run failed');
        setPendingRun(null);
      } finally {
        cancelPendingFlush();
        pendingEventsRef.current = [];
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null;
        }
        if (streamingRunIdRef.current === runId) {
          streamingRunIdRef.current = null;
        }
      }
    },
    [autoOpenExecutionPanelForRun, cancelPendingFlush, flushPendingEvents, loadThread, refreshWorkspace, scheduleEventFlush]
  );

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      cancelPendingFlush();
    };
  }, [cancelPendingFlush]);

  useEffect(() => {
    if (!pendingRunFromRoute || pendingRunHandled.current === pendingRunFromRoute.runId) return;
    pendingRunHandled.current = pendingRunFromRoute.runId;
    void streamWorkspaceTurn(pendingRunFromRoute.runId, pendingRunFromRoute.userMessage, true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate, pendingRunFromRoute, streamWorkspaceTurn]);

  useEffect(() => {
    const activeRun = activeRunFromThread;
    if (!activeRun) return;
    if (streamingRunIdRef.current === activeRun.id) return;
    if (liveRun?.runId === activeRun.id) return;
    void streamWorkspaceTurn(activeRun.id, activeRun.user_prompt, false);
  }, [activeRunFromThread, liveRun?.runId, streamWorkspaceTurn]);

  useEffect(() => {
    if (!liveRunHandoff) return;
    if (!hasCanonicalAssistant(thread, liveRunHandoff)) return;
    liveRunRef.current = null;
    setLiveRun(null);
    setLiveRunHandoff(null);
  }, [liveRunHandoff, thread]);

  const handleExecutionPanelOpenChange = useCallback((open: boolean) => {
    setExecutionPanelOpen(open);
    if (!open) {
      const currentLiveRunId = liveRun?.runId || pendingRun?.runId || activeRunFromThread?.id || null;
      if (currentLiveRunId) {
        setExecutionPanelDismissedRunId(currentLiveRunId);
      }
      return;
    }

    setExecutionPanelDismissedRunId(current =>
      current && current === (liveRun?.runId || pendingRun?.runId || activeRunFromThread?.id || null) ? null : current
    );
  }, [activeRunFromThread?.id, liveRun?.runId, pendingRun?.runId]);

  async function handleSend() {
    if (!input.trim() || !workspaceState.workspace) return;
    const userMessage = input.trim();

    setInput('');

    try {
      const runCreation = await createWorkspaceRun(workspaceState.workspace.id, {
        conversation_id: conversationId,
        user_message: userMessage,
        stream: true,
      });
      await streamWorkspaceTurn(runCreation.run_id, userMessage, true);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to send workspace message');
    }
  }

  const latestRun = useMemo(
    () =>
      [...thread.turns]
        .reverse()
        .map(turn => turn.run)
        .find(run => Boolean(run)) || null,
    [thread.turns]
  );
  const latestRunSteps = useMemo(() => (latestRun ? thread.runSteps[latestRun.id] || [] : []), [latestRun, thread.runSteps]);
  const liveReference = liveRun
    ? { runId: liveRun.runId, turnId: liveRun.turnId ?? null }
    : liveRunHandoff;
  const hideLiveResponse = liveReference ? hasCanonicalAssistant(thread, liveReference) : false;

  if (workspaceState.loading) return <PageLoading title="Loading workspace" />;
  if (workspaceState.error) return <PageError title="Workspace unavailable" message={workspaceState.error} />;
  if (!workspaceState.workspace) {
    return <PageError title="Workspace not found" message="The requested workspace could not be loaded." />;
  }

  const timeline = timelineForWorkspaceThread(thread);
  const conversation = workspaceState.conversations.find(item => item._id === conversationId);

  const leftPane = (
    <div className="flex h-full min-h-0 flex-col">
      {threadError ? (
        <div className="shrink-0 px-0 py-2">
          <ErrorBanner message={threadError} />
        </div>
      ) : null}

      <div ref={feedRef} onScroll={handleFeedScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-0 py-2">
          {loadingThread ? <LoadingState label="Loading workspace chat" className="py-6" /> : null}
          {!loadingThread && timeline.length === 0 && !pendingRun ? (
            <EmptyState title="This workspace chat is empty" copy="Ask a project-specific question below to get started." />
          ) : null}

          {timeline.map(item => {
            if (item.kind === 'message') {
              return <MessageCard key={item.id} message={item.message} variant="workspace" />;
            }

            return (
              <TraceAccordion
                key={item.id}
                run={item.run}
                steps={item.steps}
                open={expandedRuns[item.id] || false}
                onToggle={() => setExpandedRuns(current => ({ ...current, [item.id]: !current[item.id] }))}
              />
            );
          })}

          {pendingRun && !timeline.some(item => item.kind === 'message' && item.message.role === 'user' && item.message.content.trim() === pendingRun.userMessage.trim()) ? (
            <MessageCard
              message={{
                _id: 'pending-user-msg',
                role: 'user',
                content: pendingRun.userMessage,
                created_at: new Date().toISOString(),
              }}
              pending
              variant="workspace"
            />
          ) : null}
          {liveRun && !hideLiveResponse ? (
            <article className="w-full">
              <LiveAgentResponse liveRun={liveRun} />
            </article>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)]/50 bg-[var(--thread-footer)]/45 pt-2 backdrop-blur-xl">
        <div className="w-full px-0 pb-3">
          <div className="pb-2 lg:hidden">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-center rounded-full border border-[var(--border)]/60 bg-[var(--surface)]/80 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
              onClick={() => handleExecutionPanelOpenChange(true)}
            >
              <PanelRightOpen className="size-4" />
              Companion
            </Button>
          </div>
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => void handleSend()}
            placeholder="Reply in this project..."
            disabled={loadingThread || !!pendingRun}
            isLoading={!!pendingRun}
            variant="workspace"
          />
        </div>
      </div>
    </div>
  );

  const rightPane = (
    <ExecutionPanel
      liveRun={liveRun}
      fallbackRun={latestRun}
      fallbackSteps={latestRunSteps}
      storageKey={panelStorageKey}
      onRequestClose={() => handleExecutionPanelOpenChange(false)}
    />
  );

  return (
    <section className="flex h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 bg-[var(--thread-header)]">
        <div className="flex w-full items-start justify-between gap-4 px-4 pb-2 pt-0">
          <div className="min-w-0 space-y-1">
            <Button
              variant="ghost"
              className="h-8 w-fit px-2 text-[13px]"
              onClick={() => navigate(`/workspaces/${workspaceId}`)}
            >
              <ArrowLeft className="size-4" />
              {workspaceState.workspace.title}
            </Button>
            <h1 className="truncate font-heading text-[1.35rem] font-medium tracking-[-0.035em] text-[var(--text-primary)]">
              {conversation?.title || 'Project conversation'}
            </h1>
          </div>
          <TokenCounter current={conversation?.token_count ?? 0} max={maxContextTokens} />
        </div>
      </header>

      <WorkspaceSplitPane
        left={leftPane}
      right={rightPane}
      panelOpen={executionPanelOpen}
      onPanelOpenChange={handleExecutionPanelOpenChange}
      storageKey={panelStorageKey}
      />
    </section>
  );
}

function PageLoading({ title }: { title: string }) {
  return <section className="space-y-4 py-4"><LoadingState label={title} /></section>;
}

function PageError({ title, message }: { title: string; message: string }) {
  return (
    <section className="space-y-4 py-4">
      <h1 className="font-heading text-3xl font-medium tracking-[-0.04em] text-[var(--text-primary)]">{title}</h1>
      <ErrorBanner message={message} />
    </section>
  );
}
