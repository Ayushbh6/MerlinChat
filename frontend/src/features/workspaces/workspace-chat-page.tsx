import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createWorkspaceRun,
  loadWorkspaceThread,
  startWorkspaceRun,
  timelineForWorkspaceThread,
} from '../../api';
import type { WorkspaceRouteState } from '../../app/types';
import { Button } from '../../components/ui/button';
import { Composer } from '../../components/ui/composer';
import { TraceAccordion } from '../../components/ui/trace-accordion';
import { TokenCounter } from '../../components/ui/token-counter';
import { Card, CardContent } from '../../components/ui/card';
import { EmptyState, ErrorBanner, LoadingState, PageTitle } from '../../components/ui/state';
import { useMaxContextTokens } from '../../hooks/use-app-config';
import type { PendingWorkspaceRun, ThreadState } from '../../types';
import { MessageCard } from '../thread/message-card';
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
  const { state: workspaceState, refresh: refreshWorkspace } = useWorkspaceResources(workspaceId, onWorkspaceUpdated);
  const [thread, setThread] = useState<ThreadState>({ messages: [], runs: [], runSteps: {} });
  const [loadingThread, setLoadingThread] = useState(true);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pendingRun, setPendingRun] = useState<PendingWorkspaceRun | null>(pendingRunFromRoute || null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
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
  }, [thread, pendingRun, loadingThread]);

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

  const runWorkspaceTurn = useCallback(
    async (runId: string, userMessage: string) => {
      scrollTargetRef.current = 'pending-user-msg';
      setPendingRun({ runId, userMessage });
      setThreadError(null);

      try {
        await startWorkspaceRun(runId);
        await Promise.all([refreshWorkspace(), loadThread()]);
      } catch (err) {
        setThreadError(err instanceof Error ? err.message : 'Workspace run failed');
      } finally {
        setPendingRun(null);
      }
    },
    [loadThread, refreshWorkspace]
  );

  useEffect(() => {
    if (!pendingRunFromRoute || pendingRunHandled.current === pendingRunFromRoute.runId) return;
    pendingRunHandled.current = pendingRunFromRoute.runId;
    void runWorkspaceTurn(pendingRunFromRoute.runId, pendingRunFromRoute.userMessage);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate, pendingRunFromRoute, runWorkspaceTurn]);

  async function handleSend() {
    if (!input.trim() || !workspaceState.workspace) return;
    const userMessage = input.trim();

    setInput('');

    try {
      const runCreation = await createWorkspaceRun(workspaceState.workspace.id, {
        conversation_id: conversationId,
        user_message: userMessage,
        stream: false,
      });
      await runWorkspaceTurn(runCreation.run_id, userMessage);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to send workspace message');
    }
  }

  if (workspaceState.loading) return <PageLoading title="Loading workspace" />;
  if (workspaceState.error) return <PageError title="Workspace unavailable" message={workspaceState.error} />;
  if (!workspaceState.workspace) {
    return <PageError title="Workspace not found" message="The requested workspace could not be loaded." />;
  }

  const timeline = timelineForWorkspaceThread(thread);
  const conversation = workspaceState.conversations.find(item => item._id === conversationId);

  return (
    <section className="space-y-5 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <Button variant="ghost" className="w-fit" onClick={() => navigate(`/workspaces/${workspaceId}`)}>
            <ArrowLeft className="size-4" />
            {workspaceState.workspace.title}
          </Button>
          <PageTitle eyebrow="Project conversation" title={conversation?.title || 'Project conversation'} />
        </div>
        <TokenCounter current={conversation?.token_count ?? 0} max={maxContextTokens} />
      </div>

      {threadError ? <ErrorBanner message={threadError} /> : null}

      <Card className="flex h-[calc(100vh-10rem)] min-h-[42rem] flex-col p-4 sm:p-5">
        <div ref={feedRef} onScroll={handleFeedScroll} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-4">
          {loadingThread ? <LoadingState label="Loading workspace chat" className="py-6" /> : null}
          {!loadingThread && timeline.length === 0 && !pendingRun ? (
            <EmptyState title="This workspace chat is empty" copy="Ask a project-specific question below to get started." />
          ) : null}

          {timeline.map(item => {
            if (item.kind === 'message') {
              return <MessageCard key={item.id} message={item.message} />;
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
                />
              ) : null}
              <Card className="rounded-[24px] border-[var(--border)] bg-[var(--surface-elevated)]/80">
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <div className="flex items-center gap-3 text-sm font-medium text-[var(--text-primary)]">
                    <LoaderCircle className="size-4 animate-spin text-[var(--accent)]" />
                    Running workspace steps
                  </div>
                  <span className="text-xs uppercase tracking-[0.16em] text-[var(--text-tertiary)]">running</span>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => void handleSend()}
          placeholder="Reply in this project..."
          disabled={loadingThread || !!pendingRun}
          isLoading={!!pendingRun}
        />
      </Card>
    </section>
  );
}

function PageLoading({ title }: { title: string }) {
  return (
    <section className="space-y-4 py-4">
      <PageTitle eyebrow="Loading" title={title} />
      <LoadingState label={title} />
    </section>
  );
}

function PageError({ title, message }: { title: string; message: string }) {
  return (
    <section className="space-y-4 py-4">
      <PageTitle eyebrow="Error" title={title} />
      <ErrorBanner message={message} />
    </section>
  );
}
