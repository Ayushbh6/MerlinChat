import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
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
import type { LiveRunState, PendingWorkspaceRun, ThreadState } from '../../types';
import { MessageCard } from '../thread/message-card';
import { ExecutionPanel } from './execution-panel';
import { LiveAgentResponse } from './live-agent-response';
import { applyRunEvent, createLiveRunState } from './live-run';
import { useWorkspaceResources } from './use-workspace-resources';

export function WorkspaceChatPage({ onWorkspaceUpdated }: { onWorkspaceUpdated: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId = '', conversationId = '' } = useParams();
  const routeState = (location.state as WorkspaceRouteState | null) ?? null;
  const pendingRunFromRoute = routeState?.pendingRun;
  const pendingRunHandled = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const scrollTargetRef = useRef<string | null>(null);
  const followModeRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingRunIdRef = useRef<string | null>(null);
  const { state: workspaceState, refresh: refreshWorkspace } = useWorkspaceResources(workspaceId, onWorkspaceUpdated);
  const [thread, setThread] = useState<ThreadState>({ turns: [], runSteps: {} });
  const [loadingThread, setLoadingThread] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pendingRun, setPendingRun] = useState<PendingWorkspaceRun | null>(pendingRunFromRoute || null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null);
  const [executionPanelOpen, setExecutionPanelOpen] = useState(false);
  const maxContextTokens = useMaxContextTokens();

  const handleFeedScroll = useCallback(() => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    followModeRef.current = scrollHeight - scrollTop - clientHeight < 60;
  }, []);

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
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to load workspace chat');
    } finally {
      setLoadingThread(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const streamWorkspaceTurn = useCallback(
    async (runId: string, userMessage: string, startRequested: boolean) => {
      streamAbortRef.current?.abort();
      const controller = new AbortController();
      streamAbortRef.current = controller;
      streamingRunIdRef.current = runId;
      scrollTargetRef.current = 'pending-user-msg';
      setPendingRun({ runId, userMessage });
      setThreadError(null);
      setLiveRun(createLiveRunState(runId));

      try {
        const streamPromise = streamWorkspaceRunEvents({
          runId,
          signal: controller.signal,
          onEvent: event => {
            setLiveRun(current => applyRunEvent(current ?? createLiveRunState(runId), event));
            // Auto-open execution panel as soon as we get meaningful activity
            if (event.type === 'step.started' || event.type === 'step.code.delta' || event.type === 'thought.updated') {
              setExecutionPanelOpen(true);
            }
          },
        });

        if (startRequested) {
          await startWorkspaceRun(runId);
        }

        await streamPromise;

        await Promise.all([refreshWorkspace(), loadThread()]);
        setPendingRun(null);
        setLiveRun(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setThreadError(err instanceof Error ? err.message : 'Workspace run failed');
        setPendingRun(null);
      } finally {
        if (streamAbortRef.current === controller) {
          streamAbortRef.current = null;
        }
        if (streamingRunIdRef.current === runId) {
          streamingRunIdRef.current = null;
        }
      }
    },
    [loadThread, refreshWorkspace]
  );

  useEffect(() => {
    return () => streamAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!pendingRunFromRoute || pendingRunHandled.current === pendingRunFromRoute.runId) return;
    pendingRunHandled.current = pendingRunFromRoute.runId;
    void streamWorkspaceTurn(pendingRunFromRoute.runId, pendingRunFromRoute.userMessage, true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate, pendingRunFromRoute, streamWorkspaceTurn]);

  useEffect(() => {
    const activeRun = thread.turns
      .map(turn => turn.run)
      .find(run => run && (run.status === 'queued' || run.status === 'running'));
    if (!activeRun) return;
    if (streamingRunIdRef.current === activeRun.id) return;
    if (liveRun?.runId === activeRun.id) return;
    void streamWorkspaceTurn(activeRun.id, activeRun.user_prompt, false);
  }, [liveRun?.runId, streamWorkspaceTurn, thread.turns]);

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
        <div className="shrink-0 px-1 py-3">
          <ErrorBanner message={threadError} />
        </div>
      ) : null}

      <div ref={feedRef} onScroll={handleFeedScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-8 px-1 py-3">
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

          {pendingRun ? (
            <>
              {!timeline.some(item => item.kind === 'message' && item.message.role === 'user' && item.message.content.trim() === pendingRun.userMessage.trim()) ? (
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
              {liveRun ? (
                <article className="w-full">
                  <LiveAgentResponse liveRun={liveRun} />
                </article>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)]/50 bg-[var(--thread-footer)]/60 pt-3 backdrop-blur-xl">
        <div className="w-full px-1 pb-4">
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

  const rightPane = <ExecutionPanel liveRun={liveRun} fallbackRun={latestRun} fallbackSteps={latestRunSteps} />;

  return (
    <section className="flex h-[calc(100vh-5.5rem)] min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 bg-[var(--thread-header)]">
        <div className="flex w-full items-start justify-between gap-4 px-6 pb-3 pt-1">
          <div className="min-w-0 space-y-2">
            <Button variant="ghost" className="w-fit" onClick={() => navigate(`/workspaces/${workspaceId}`)}>
              <ArrowLeft className="size-4" />
              {workspaceState.workspace.title}
            </Button>
            <h1 className="truncate font-heading text-[1.55rem] font-medium tracking-[-0.035em] text-[var(--text-primary)]">
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
        onPanelOpenChange={setExecutionPanelOpen}
        storageKey={`workspace-chat:${workspaceId}:${conversationId}`}
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
