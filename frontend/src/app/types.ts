import type { PendingWorkspaceRun } from '../types';

export type AppMode = 'chat' | 'workspaces';

export interface GeneralChatRouteState {
  initialPrompt?: string;
}

export interface WorkspaceRouteState {
  flashMessage?: string;
  pendingRun?: PendingWorkspaceRun;
}

