import type { LiveRunState, LiveRunStepDraft, RunEvent, RunStep, RunStepArtifact } from '../../types';

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asArtifacts(value: unknown): RunStepArtifact[] {
  return Array.isArray(value) ? (value as RunStepArtifact[]) : [];
}

function ensureActiveStep(state: LiveRunState, stepIndex: number, thought?: string) {
  if (state.activeStep && state.activeStep.step_index === stepIndex) {
    if (thought) {
      state.activeStep.thought = thought;
    }
    return state.activeStep;
  }

  const draft: LiveRunStepDraft = {
    step_index: stepIndex,
    thought: thought || null,
    code: '',
    stdout: '',
    stderr: '',
    exit_code: null,
    artifacts: [],
    duration_ms: 0,
    status: 'running',
  };
  state.activeStep = draft;
  return draft;
}

function upsertCompletedStep(state: LiveRunState, step: RunStep) {
  const next = state.completedSteps.filter(item => item.step_index !== step.step_index);
  next.push(step);
  next.sort((left, right) => left.step_index - right.step_index);
  state.completedSteps = next;
}

export function createLiveRunState(runId: string): LiveRunState {
  return {
    runId,
    status: 'idle',
    phase: 'initializing',
    thought: '',
    answerDraft: '',
    activeStep: null,
    completedSteps: [],
    eventTrail: [],
    lastSeq: 0,
    failureReason: null,
  };
}

export function applyRunEvent(current: LiveRunState, event: RunEvent): LiveRunState {
  const state: LiveRunState = {
    ...current,
    completedSteps: [...current.completedSteps],
    activeStep: current.activeStep ? { ...current.activeStep, artifacts: [...current.activeStep.artifacts] } : null,
    eventTrail: [...current.eventTrail, event],
    lastSeq: event.seq,
  };
  const payload = event.ui_payload || event.payload || {};

  switch (event.type) {
    case 'turn.started':
      state.status = 'running';
      state.phase = 'initializing';
      state.turnId = typeof event.turn_id === 'string' ? event.turn_id : state.turnId;
      state.traceId = typeof event.trace_id === 'string' ? event.trace_id : state.traceId;
      return state;
    case 'run.queued':
      state.status = 'running';
      state.phase = 'initializing';
      return state;
    case 'run.started':
      state.status = 'running';
      state.phase = 'initializing';
      return state;
    case 'thought.updated':
      state.status = state.status === 'idle' ? 'running' : state.status;
      state.thought = asString(payload.thought);
      state.phase = 'thinking';
      if (typeof payload.step_index === 'number') {
        ensureActiveStep(state, payload.step_index, state.thought);
      }
      return state;
    case 'step.started': {
      state.status = 'running';
      state.phase = 'coding';
      const step = ensureActiveStep(state, asNumber(payload.step_index, state.completedSteps.length + 1), asString(payload.thought));
      step.status = 'running';
      return state;
    }
    case 'step.code.delta': {
      state.phase = 'coding';
      const step = ensureActiveStep(state, asNumber(payload.step_index, state.completedSteps.length + 1));
      step.code += asString(payload.chunk);
      return state;
    }
    case 'step.stdout.delta': {
      state.phase = 'executing';
      const step = ensureActiveStep(state, asNumber(payload.step_index, state.completedSteps.length + 1));
      step.stdout += asString(payload.chunk);
      return state;
    }
    case 'step.stderr.delta': {
      state.phase = 'executing';
      const step = ensureActiveStep(state, asNumber(payload.step_index, state.completedSteps.length + 1));
      step.stderr += asString(payload.chunk);
      return state;
    }
    case 'step.completed': {
      const completed: RunStep = {
        id: `live-step-${asNumber(payload.step_index)}`,
        run_id: current.runId,
        step_index: asNumber(payload.step_index),
        thought: asString(payload.thought) || null,
        code: asString(payload.code),
        stdout: asString(payload.stdout),
        stderr: asString(payload.stderr),
        exit_code: asNumber(payload.exit_code),
        artifacts: asArtifacts(payload.artifacts),
        next_step_needed: true,
        duration_ms: asNumber(payload.duration_ms),
        created_at: asString(payload.created_at) || event.created_at,
      };
      upsertCompletedStep(state, completed);
      if (state.activeStep && state.activeStep.step_index === completed.step_index) {
        state.activeStep = null;
      }
      state.phase = 'waiting_next_turn';
      return state;
    }
    case 'artifact.created':
      if (state.activeStep && state.activeStep.step_index === asNumber(payload.step_index, state.activeStep.step_index)) {
        state.activeStep.artifacts = [...state.activeStep.artifacts, ...(asArtifacts([payload.artifact]))];
      }
      return state;
    case 'answer.delta':
      state.status = 'running';
      state.phase = 'answering';
      state.answerDraft += asString(payload.chunk);
      return state;
    case 'turn.completed':
      state.status = 'completed';
      state.phase = 'done';
      return state;
    case 'turn.failed':
      state.status = 'failed';
      state.phase = 'done';
      state.failureReason = asString(payload.failure_reason) || 'Workspace run failed';
      return state;
    default:
      return state;
  }
}
