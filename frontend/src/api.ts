import type {
  Conversation,
  Message,
  PendingWorkspaceRun,
  Run,
  RunStep,
  StagedWorkspaceNote,
  Workspace,
  WorkspaceFile,
} from './types';

export const API_BASE = 'http://localhost:8000/api';

export async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      detail = body?.detail || detail;
    } catch {
      // ignore non-json responses
    }
    throw new Error(detail);
  }
  return response.json();
}

export function formatDate(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelativeDate(value?: string) {
  if (!value) return 'just now';
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60000) return 'just now';
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks}w ago`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isVisionAvailable(file: WorkspaceFile) {
  return file.content_type.toLowerCase().startsWith('image/');
}

export async function getWorkspaces() {
  return readJson<Workspace[]>(`${API_BASE}/workspaces`);
}

export async function getAppConfig() {
  return readJson<{ max_context_tokens: number; default_model: string }>(`${API_BASE}/config`);
}

export async function getWorkspace(workspaceId: string) {
  return readJson<Workspace>(`${API_BASE}/workspaces/${workspaceId}`);
}

export async function getWorkspaceFiles(workspaceId: string) {
  return readJson<{ files: WorkspaceFile[] }>(`${API_BASE}/workspaces/${workspaceId}/files`);
}

export async function getWorkspaceConversations(workspaceId: string) {
  return readJson<Conversation[]>(`${API_BASE}/workspaces/${workspaceId}/conversations`);
}

export async function getConversations() {
  return readJson<Conversation[]>(`${API_BASE}/conversations`);
}

export async function getConversation(conversationId: string) {
  return readJson<Conversation>(`${API_BASE}/conversations/${conversationId}`);
}

export async function renameConversation(conversationId: string, title: string) {
  return readJson<{ status: string }>(`${API_BASE}/conversations/${conversationId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(conversationId: string) {
  return readJson<{ status: string }>(`${API_BASE}/conversations/${conversationId}`, {
    method: 'DELETE',
  });
}

export async function deleteWorkspaceFile(workspaceId: string, fileId: string) {
  return readJson<{ status: string }>(`${API_BASE}/workspaces/${workspaceId}/files/${fileId}`, {
    method: 'DELETE',
  });
}

export async function getConversationMessages(conversationId: string) {
  return readJson<Message[]>(`${API_BASE}/conversations/${conversationId}/messages`);
}

export async function getConversationRuns(conversationId: string) {
  return readJson<{ runs: Run[] }>(`${API_BASE}/conversations/${conversationId}/runs`);
}

export async function getRunSteps(runId: string) {
  return readJson<{ steps: RunStep[] }>(`${API_BASE}/runs/${runId}/steps`);
}

export async function loadWorkspaceThread(conversationId: string) {
  const [messages, runsPayload] = await Promise.all([
    getConversationMessages(conversationId),
    getConversationRuns(conversationId),
  ]);
  const stepEntries = await Promise.all(
    runsPayload.runs.map(async run => {
      const stepsPayload = await getRunSteps(run.id);
      return [run.id, stepsPayload.steps] as const;
    })
  );
  return {
    messages,
    runs: runsPayload.runs,
    runSteps: Object.fromEntries(stepEntries),
  };
}

export async function createConversation(payload?: { title?: string; workspace_id?: string | null }) {
  return readJson<Conversation>(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
}

export async function createWorkspace(payload: {
  title: string;
  description?: string | null;
  subject_area?: string | null;
  semester?: string | null;
}) {
  return readJson<Workspace>(`${API_BASE}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function uploadWorkspaceFiles(workspaceId: string, files: File[]) {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  return readJson<{ files: WorkspaceFile[] }>(`${API_BASE}/workspaces/${workspaceId}/files`, {
    method: 'POST',
    body: formData,
  });
}

export async function createWorkspaceTextFile(
  workspaceId: string,
  note: Pick<StagedWorkspaceNote, 'title' | 'body'>
) {
  return readJson<WorkspaceFile>(`${API_BASE}/workspaces/${workspaceId}/text-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
}

export async function createWorkspaceRun(
  workspaceId: string,
  payload: { conversation_id?: string | null; user_message: string; stream?: boolean }
) {
  return readJson<{
    run_id: string;
    status: string;
    conversation_id: string;
    stream_url?: string | null;
  }>(`${API_BASE}/workspaces/${workspaceId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function startWorkspaceRun(runId: string) {
  return readJson(`${API_BASE}/runs/${runId}/start`, { method: 'POST' });
}

export async function createWorkspaceWithAttachments(payload: {
  title: string;
  description: string;
  subject_area: string;
  semester: string;
  files: File[];
  notes: StagedWorkspaceNote[];
}) {
  const workspace = await createWorkspace({
    title: payload.title.trim(),
    description: payload.description.trim() || null,
    subject_area: payload.subject_area.trim() || null,
    semester: payload.semester.trim() || null,
  });

  const failures: string[] = [];

  if (payload.files.length > 0) {
    try {
      await uploadWorkspaceFiles(workspace.id, payload.files);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Failed to upload files');
    }
  }

  for (const note of payload.notes) {
    try {
      await createWorkspaceTextFile(workspace.id, note);
    } catch (error) {
      failures.push(
        error instanceof Error ? `Note "${note.title}": ${error.message}` : `Note "${note.title}" failed`
      );
    }
  }

  return { workspace, failures };
}

type StreamEvent =
  | { type: 'meta'; conversation_id: string }
  | { type: 'content'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'token_count'; count: number }
  | { type: 'error'; content: string };

export async function streamGeneralChat(payload: {
  conversationId?: string;
  message: string;
  model?: string;
  thinking?: boolean;
  onMeta?: (conversationId: string) => void;
  onContent?: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onTokenCount?: (count: number) => void;
}) {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: payload.conversationId,
      message: payload.message,
      model: payload.model,
      thinking: payload.thinking ?? true,
    }),
  });

  if (!response.ok || !response.body) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      detail = body?.detail || detail;
    } catch {
      // ignore non-json responses
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawBlock = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);

      if (rawBlock.startsWith('data:')) {
        const rawValue = rawBlock
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('');

        if (rawValue === '[DONE]') {
          return;
        }

        const event = JSON.parse(rawValue) as StreamEvent;
        if (event.type === 'meta') payload.onMeta?.(event.conversation_id);
        if (event.type === 'content') payload.onContent?.(event.content);
        if (event.type === 'thinking') payload.onThinking?.(event.content);
        if (event.type === 'token_count') payload.onTokenCount?.(event.count);
        if (event.type === 'error') throw new Error(event.content);
      }

      boundary = buffer.indexOf('\n\n');
    }

    if (done) break;
  }
}

export function timelineForWorkspaceThread(thread: {
  messages: Message[];
  runs: Run[];
  runSteps: Record<string, RunStep[]>;
}) {
  const timeline: Array<
    | { kind: 'message'; id: string; createdAt: string; message: Message }
    | { kind: 'run'; id: string; createdAt: string; run: Run; steps: RunStep[] }
  > = [];

  thread.messages.forEach((message, index) => {
    timeline.push({
      kind: 'message',
      id: message._id || `message-${index}`,
      createdAt: message.created_at || new Date(0).toISOString(),
      message,
    });
  });

  thread.runs.forEach(run => {
    timeline.push({
      kind: 'run',
      id: run.id,
      createdAt: run.created_at,
      run,
      steps: thread.runSteps[run.id] || [],
    });
  });

  timeline.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  return timeline;
}

export function pendingRunState(runId: string, userMessage: string): PendingWorkspaceRun {
  return { runId, userMessage };
}
