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
  conversation_id?: string;
  workspace_id?: string | null;
  turn_id?: string | null;
  run_id?: string | null;
  trace_id?: string | null;
  role: 'user' | 'assistant';
  message_kind?: string | null;
  content: string;
  trace_summary?: AssistantTraceSummary | null;
  thinking?: string | null;
  created_at?: string;
}

export interface Run {
  id: string;
  workspace_id: string;
  conversation_id: string;
  turn_id?: string | null;
  trace_id?: string | null;
  user_prompt: string;
  model: string;
  status: string;
  step_count: number;
  worker_task_id?: string | null;
  attempt_count?: number;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  heartbeat_at?: string | null;
  lease_expires_at?: string | null;
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
  turn_id?: string | null;
  trace_id?: string | null;
  step_index: number;
  thought?: string | null;
  step_type?: string;
  blocked_reason?: string | null;
  model_decision_id?: string | null;
  code: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  artifacts: RunStepArtifact[];
  next_step_needed: boolean;
  duration_ms: number;
  created_at: string;
}

export interface AssistantTraceSummary {
  trace_id: string;
  status?: string | null;
  latest_seq?: number;
  latest_event_type?: string | null;
  last_event_type?: string | null;
  last_thought?: string | null;
  step_count?: number;
  artifact_count?: number;
  run_status?: string | null;
}

export interface AgentTrace {
  id: string;
  turn_id: string;
  conversation_id: string;
  workspace_id: string;
  run_id: string;
  status: string;
  latest_seq: number;
  raw_debug_enabled: boolean;
  summary: AssistantTraceSummary;
  created_at: string;
  updated_at: string;
}

export interface AgentTraceEvent {
  id: string;
  trace_id: string;
  turn_id: string;
  run_id: string;
  seq: number;
  event_type: string;
  scope: string;
  payload: Record<string, unknown>;
  ui_payload: Record<string, unknown>;
  raw_debug_ref?: string | null;
  created_at: string;
}

export interface ConversationTurn {
  id: string;
  conversation_id: string;
  workspace_id: string;
  user_message_id?: string | null;
  assistant_message_id?: string | null;
  run_id?: string | null;
  trace_id?: string | null;
  status: string;
  model?: string | null;
  failure_reason?: string | null;
  token_counts?: Record<string, number>;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  user_message: Message | null;
  assistant_message: Message | null;
  run: Run | null;
  trace: AgentTrace | null;
}

export interface RunEvent {
  id: string;
  run_id: string;
  trace_id?: string;
  turn_id?: string;
  seq: number;
  type:
    | 'turn.started'
    | 'run.queued'
    | 'run.started'
    | 'thought.updated'
    | 'llm.call.started'
    | 'llm.call.completed'
    | 'step.started'
    | 'step.code.delta'
    | 'step.stdout.delta'
    | 'step.stderr.delta'
    | 'step.completed'
    | 'artifact.created'
    | 'answer.delta'
    | 'turn.completed'
    | 'turn.failed';
  scope?: string;
  payload: Record<string, unknown>;
  ui_payload?: Record<string, unknown>;
  created_at: string;
}

export interface LiveRunStepDraft {
  step_index: number;
  thought?: string | null;
  code: string;
  stdout: string;
  stderr: string;
  exit_code?: number | null;
  artifacts: RunStepArtifact[];
  duration_ms: number;
  created_at?: string;
  status: 'running' | 'completed';
}

export interface LiveRunState {
  runId: string;
  turnId?: string | null;
  traceId?: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
  /** Current high-level phase for the UI to render the correct visual state */
  phase:
    | 'initializing'
    | 'thinking'
    | 'coding'
    | 'executing'
    | 'waiting_next_turn'
    | 'answering'
    | 'done';
  thought: string;
  answerDraft: string;
  activeStep: LiveRunStepDraft | null;
  completedSteps: RunStep[];
  eventTrail: RunEvent[];
  lastSeq: number;
  failureReason?: string | null;
}

export interface ExecutionPanelState {
  isOpen: boolean;
  ratio: number;
  mobileOpen: boolean;
}

export interface ThreadState {
  turns: ConversationTurn[];
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
