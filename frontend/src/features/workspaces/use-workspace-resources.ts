import { useCallback, useEffect, useState } from 'react';
import {
  createWorkspaceTextFile,
  deleteWorkspaceFile,
  getWorkspace,
  getWorkspaceConversations,
  getWorkspaceFiles,
  uploadWorkspaceFiles,
} from '../../api';
import type { Conversation, StagedWorkspaceNote, Workspace, WorkspaceFile } from '../../types';

interface WorkspaceResourceState {
  workspace: Workspace | null;
  files: WorkspaceFile[];
  conversations: Conversation[];
  loading: boolean;
  error: string | null;
}

export function useWorkspaceResources(workspaceId: string, onWorkspaceUpdated: () => Promise<void>) {
  const [state, setState] = useState<WorkspaceResourceState>({
    workspace: null,
    files: [],
    conversations: [],
    loading: true,
    error: null,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingNote, setIsCreatingNote] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;

    setState(current => ({ ...current, loading: true, error: null }));

    try {
      const [workspace, filesPayload, conversations] = await Promise.all([
        getWorkspace(workspaceId),
        getWorkspaceFiles(workspaceId),
        getWorkspaceConversations(workspaceId),
      ]);

      setState({
        workspace,
        files: filesPayload.files,
        conversations,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState(current => ({
        ...current,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load workspace',
      }));
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadFilesToWorkspace(files: FileList | null) {
    if (!files?.length || !workspaceId) return;

    setIsUploading(true);
    try {
      await uploadWorkspaceFiles(workspaceId, Array.from(files));
      await Promise.all([refresh(), onWorkspaceUpdated()]);
    } finally {
      setIsUploading(false);
    }
  }

  async function createNoteInWorkspace(note: Pick<StagedWorkspaceNote, 'title' | 'body'>) {
    if (!workspaceId) return;

    setIsCreatingNote(true);
    try {
      await createWorkspaceTextFile(workspaceId, note);
      await Promise.all([refresh(), onWorkspaceUpdated()]);
    } finally {
      setIsCreatingNote(false);
    }
  }

  async function deleteFileFromWorkspace(fileId: string) {
    if (!workspaceId) return;

    setState(current => ({ ...current, files: current.files.filter(file => file.id !== fileId) }));
    try {
      await deleteWorkspaceFile(workspaceId, fileId);
      await onWorkspaceUpdated();
    } catch (err) {
      setState(current => ({ ...current, error: err instanceof Error ? err.message : 'Failed to delete file' }));
      await refresh();
    }
  }

  function removeConversation(conversationId: string) {
    setState(current => ({
      ...current,
      conversations: current.conversations.filter(conversation => conversation._id !== conversationId),
    }));
  }

  return {
    state,
    refresh,
    uploadFilesToWorkspace,
    createNoteInWorkspace,
    deleteFileFromWorkspace,
    removeConversation,
    isUploading,
    isCreatingNote,
  };
}

