export type Theme = 'dark' | 'light';

export interface Workspace {
  id: string;
  title: string;
  description?: string | null;
  subject_area?: string | null;
  semester?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceFile {
  id: string;
  workspace_id: string;
  filename: string;
  stored_filename: string;
  content_type: string;
  size_bytes: number;
  storage_backend: string;
  storage_path: string;
  status: string;
  created_at: string;
}

export interface Conversation {
  _id: string;
  title: string;
  workspace_id?: string | null;
  created_at: string;
  updated_at: string;
  token_count?: number | null;
}

export interface Message {
  _id?: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string | null;
  created_at?: string;
}

export interface Run {
  id: string;
  workspace_id: string;
  conversation_id: string;
  user_prompt: string;
  model: string;
  status: string;
  step_count: number;
  final_answer?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunStepArtifact {
  name: string;
  path?: string;
  agent_path?: string;
  relative_path?: string;
  content_type?: string;
  size_bytes?: number;
}

export interface RunStep {
  id: string;
  run_id: string;
  step_index: number;
  thought?: string | null;
  code: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  artifacts: RunStepArtifact[];
  next_step_needed: boolean;
  duration_ms: number;
  created_at: string;
}

export interface ThreadState {
  messages: Message[];
  runs: Run[];
  runSteps: Record<string, RunStep[]>;
}

export interface StagedWorkspaceNote {
  id: string;
  title: string;
  body: string;
}

export interface PendingWorkspaceRun {
  runId: string;
  userMessage: string;
}

