import { useState } from 'react';
import { ArrowLeft, ChevronRight, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createWorkspaceRun,
  deleteConversation,
  formatBytes,
  formatRelativeDate,
  isVisionAvailable,
  pendingRunState,
  renameConversation,
} from '../../api';
import type { WorkspaceRouteState } from '../../app/types';
import {
  AlertActionButton,
  AlertCancelButton,
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Composer } from '../../components/ui/composer';
import { DropdownActionMenu } from '../../components/ui/dropdown-action-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { EmptyState, ErrorBanner, LoadingState, PageTitle, SuccessBanner } from '../../components/ui/state';
import { Textarea } from '../../components/ui/textarea';
import { useWorkspaceResources } from './use-workspace-resources';
import type { Conversation, StagedWorkspaceNote, Workspace, WorkspaceFile } from '../../types';

export function WorkspaceHubPage({ onWorkspaceUpdated }: { onWorkspaceUpdated: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId = '' } = useParams();
  const routeState = (location.state as WorkspaceRouteState | null) ?? null;
  const {
    state,
    refresh,
    uploadFilesToWorkspace,
    createNoteInWorkspace,
    deleteFileFromWorkspace,
    removeConversation,
    isUploading,
    isCreatingNote,
  } = useWorkspaceResources(workspaceId, onWorkspaceUpdated);
  const [prompt, setPrompt] = useState('');
  const [launching, setLaunching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);

  async function handleDeleteWorkspaceChat(conversationId: string) {
    removeConversation(conversationId);

    try {
      await deleteConversation(conversationId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete chat');
      await refresh();
    }
  }

  async function handleRenameWorkspaceChat() {
    if (!renameTarget || !renameDraft.trim() || renameDraft.trim() === renameTarget.title) {
      setRenameTarget(null);
      return;
    }

    try {
      await renameConversation(renameTarget._id, renameDraft.trim());
      await refresh();
      setRenameTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to rename conversation');
    }
  }

  async function handleStartWorkspaceChat() {
    if (!prompt.trim() || !state.workspace) return;
    const userMessage = prompt.trim();

    setPrompt('');
    setLaunching(true);
    setActionError(null);

    try {
      const runCreation = await createWorkspaceRun(state.workspace.id, {
        user_message: userMessage,
        stream: false,
      });
      await refresh();
      navigate(`/workspaces/${state.workspace.id}/chats/${runCreation.conversation_id}`, {
        state: { pendingRun: pendingRunState(runCreation.run_id, userMessage) } satisfies WorkspaceRouteState,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start workspace chat');
    } finally {
      setLaunching(false);
    }
  }

  if (state.loading) return <PageLoading title="Loading workspace" />;
  if (state.error) return <PageError title="Workspace unavailable" message={state.error} />;
  if (!state.workspace) return <PageError title="Workspace not found" message="The requested workspace could not be loaded." />;

  return (
    <section className="space-y-6 py-4">
      <Button variant="ghost" className="w-fit" onClick={() => navigate('/workspaces')}>
        <ArrowLeft className="size-4" />
        All projects
      </Button>

      {actionError ? <ErrorBanner message={actionError} /> : null}
      {routeState?.flashMessage ? <SuccessBanner message={routeState.flashMessage} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
        <main className="space-y-6">
          <PageTitle
            eyebrow="Project"
            title={state.workspace.title}
            copy={state.workspace.description || 'Use this project to keep files and project-specific chats together.'}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{state.files.length} files</Badge>
                <Badge>{state.conversations.length} chats</Badge>
                <Badge>{formatRelativeDate(state.workspace.updated_at)}</Badge>
              </div>
            }
          />

          <Card className="p-4">
            <Composer
              value={prompt}
              onChange={setPrompt}
              onSubmit={handleStartWorkspaceChat}
              placeholder="Start a new chat in this project..."
              disabled={launching}
              isLoading={launching}
            />
          </Card>

          <Card>
            <CardHeader>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Chats</p>
                <h2 className="font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">Project conversations</h2>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {state.conversations.length === 0 ? (
                <EmptyState title="No chats yet" copy="Type the first prompt above to create one." />
              ) : (
                state.conversations.map(conversation => (
                  <Card key={conversation._id} className="rounded-[24px] border-[var(--border)] bg-[var(--surface-elevated)]/80">
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
                        onClick={() => navigate(`/workspaces/${workspaceId}/chats/${conversation._id}`)}
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-medium text-[var(--text-primary)]">{conversation.title}</p>
                          <p className="text-sm text-[var(--text-secondary)]">
                            Last message {formatRelativeDate(conversation.updated_at)}
                          </p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-[var(--text-tertiary)]" />
                      </button>
                      <DropdownActionMenu
                        items={[
                          {
                            label: 'Rename',
                            icon: <Pencil className="size-4" />,
                            onSelect: () => {
                              setRenameTarget(conversation);
                              setRenameDraft(conversation.title);
                            },
                          },
                          {
                            label: 'Delete',
                            icon: <Trash2 className="size-4" />,
                            danger: true,
                            onSelect: () => setDeleteTarget(conversation),
                          },
                        ]}
                      />
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        </main>

        <WorkspaceResourcePanel
          workspace={state.workspace}
          files={state.files}
          isUploading={isUploading}
          isCreatingNote={isCreatingNote}
          onUpload={uploadFilesToWorkspace}
          onCreateNote={createNoteInWorkspace}
          onDeleteFile={deleteFileFromWorkspace}
        />
      </div>

      <Dialog open={!!renameTarget} onOpenChange={open => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>Give this project chat a clearer title without affecting its messages or run history.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Input value={renameDraft} onChange={event => setRenameDraft(event.target.value)} autoFocus />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleRenameWorkspaceChat()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Delete "${deleteTarget.title}"? This cannot be undone.` : 'This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertCancelButton onClick={() => setDeleteTarget(null)}>Cancel</AlertCancelButton>
            <AlertActionButton
              onClick={() => {
                if (!deleteTarget) return;
                void handleDeleteWorkspaceChat(deleteTarget._id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function WorkspaceResourcePanel({
  workspace,
  files,
  isUploading,
  isCreatingNote,
  onUpload,
  onCreateNote,
  onDeleteFile,
}: {
  workspace: Workspace;
  files: WorkspaceFile[];
  isUploading: boolean;
  isCreatingNote: boolean;
  onUpload: (files: FileList | null) => Promise<void>;
  onCreateNote: (note: Pick<StagedWorkspaceNote, 'title' | 'body'>) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
}) {
  const [deleteFile, setDeleteFile] = useState<WorkspaceFile | null>(null);

  return (
    <aside className="space-y-6">
      <Card>
        <CardHeader className="items-center">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Files</p>
            <h2 className="font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">{workspace.title}</h2>
          </div>
          <label>
            <Button type="button" variant="secondary" asChild>
              <span>
                <Upload className="size-4" />
                {isUploading ? 'Uploading...' : 'Upload'}
              </span>
            </Button>
            <input type="file" multiple hidden onChange={event => void onUpload(event.target.files)} />
          </label>
        </CardHeader>
        <CardContent className="space-y-4">
          <InlineNoteForm onSubmit={onCreateNote} loading={isCreatingNote} />
          {files.length === 0 ? (
            <EmptyState title="No files yet" copy="Upload source material or create a quick note to ground this project." />
          ) : (
            files.map(file => (
              <Card key={file.id} className="rounded-[24px] bg-[var(--surface-elevated)]/80">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="font-medium text-[var(--text-primary)]">{file.filename}</p>
                      <p className="text-sm text-[var(--text-secondary)]">{formatBytes(file.size_bytes)}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setDeleteFile(file)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{file.content_type.split('/').pop()}</Badge>
                    <Badge>{file.status}</Badge>
                    {isVisionAvailable(file) ? <Badge variant="accent">vision</Badge> : null}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteFile} onOpenChange={open => !open && setDeleteFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFile ? `Delete "${deleteFile.filename}"? This cannot be undone.` : 'This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertCancelButton onClick={() => setDeleteFile(null)}>Cancel</AlertCancelButton>
            <AlertActionButton
              onClick={() => {
                if (!deleteFile) return;
                void onDeleteFile(deleteFile.id);
                setDeleteFile(null);
              }}
            >
              Delete
            </AlertActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function InlineNoteForm({
  onSubmit,
  loading,
}: {
  onSubmit: (note: Pick<StagedWorkspaceNote, 'title' | 'body'>) => Promise<void>;
  loading: boolean;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || loading) return;

    await onSubmit({ title: title.trim(), body });
    setTitle('');
    setBody('');
  }

  return (
    <Card className="rounded-[24px] bg-[var(--surface-soft)]/70">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Quick Note</p>
            <h3 className="font-heading text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Create text file</h3>
          </div>
          <Button type="submit" variant="secondary" disabled={loading || !title.trim()} form="quick-note-form">
            <FileText className="size-4" />
            Save
          </Button>
        </div>
        <form id="quick-note-form" className="space-y-3" onSubmit={handleSubmit}>
          <Input value={title} onChange={event => setTitle(event.target.value)} placeholder="lecture-summary.md" />
          <Textarea
            rows={4}
            value={body}
            onChange={event => setBody(event.target.value)}
            placeholder="Paste project notes or instructions."
          />
        </form>
      </CardContent>
    </Card>
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
