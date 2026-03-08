import type React from 'react';
import { useState } from 'react';
import {
  FolderPlus,
  LayoutPanelLeft,
  LoaderCircle,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Sparkles,
  SunMedium,
  Trash2,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { deleteConversation, formatRelativeDate, renameConversation } from '../api';
import type { AppMode } from './types';
import type { Conversation, Theme, Workspace } from '../types';
import { Button } from '../components/ui/button';
import { DropdownActionMenu } from '../components/ui/dropdown-action-menu';
import { ScrollArea } from '../components/ui/scroll-area';
import { Card } from '../components/ui/card';
import {
  AlertActionButton,
  AlertCancelButton,
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';

export function AppSidebar({
  open,
  theme,
  setTheme,
  onToggleOpen,
  generalChats,
  loadingGeneralChats,
  workspaces,
  loadingWorkspaces,
  onGeneralChatsUpdated,
}: {
  open: boolean;
  theme: Theme;
  setTheme: React.Dispatch<React.SetStateAction<Theme>>;
  onToggleOpen: () => void;
  generalChats: Conversation[];
  loadingGeneralChats: boolean;
  workspaces: Workspace[];
  loadingWorkspaces: boolean;
  onGeneralChatsUpdated: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const mode: AppMode = location.pathname.startsWith('/workspaces') ? 'workspaces' : 'chat';
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleRename() {
    if (!renameTarget || !renameDraft.trim() || renameDraft.trim() === renameTarget.title) {
      setRenameTarget(null);
      return;
    }

    try {
      await renameConversation(renameTarget._id, renameDraft.trim());
      await onGeneralChatsUpdated();
      setRenameTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to rename conversation');
    }
  }

  async function handleDelete(target: Conversation) {
    try {
      await deleteConversation(target._id);
      if (location.pathname === `/chat/${target._id}`) navigate('/chat');
      await onGeneralChatsUpdated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="fixed left-4 top-4 z-50"
        onClick={onToggleOpen}
        aria-label={open ? 'Close sidebar' : 'Open sidebar'}
      >
        {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
      </Button>

      {open ? <button type="button" className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" onClick={onToggleOpen} /> : null}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--surface)]/82 backdrop-blur-2xl transition-transform duration-300',
          open ? 'translate-x-0' : '-translate-x-full lg:-translate-x-[calc(var(--sidebar-width)+1rem)]',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4">
          <button type="button" className="flex items-center gap-3 text-left" onClick={() => navigate('/chat')}>
            <div className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Sparkles className="size-4" />
            </div>
            <div className="space-y-0.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">Atlas AI</div>
              <div className="font-heading text-lg font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Assistant</div>
            </div>
          </button>
          <div className="size-10" />
        </div>

        <div className="grid gap-2 px-4 py-4">
          <Button variant={mode === 'chat' ? 'default' : 'secondary'} className="justify-start" onClick={() => navigate('/chat')}>
            <MessageSquare className="size-4" />
            Chat
          </Button>
          <Button
            variant={mode === 'workspaces' ? 'default' : 'secondary'}
            className="justify-start"
            onClick={() => navigate('/workspaces')}
          >
            <LayoutPanelLeft className="size-4" />
            Workspaces
          </Button>
        </div>

        <div className="px-4">
          <Button className="w-full justify-start" onClick={() => navigate(mode === 'chat' ? '/chat' : '/workspaces/new')}>
            {mode === 'chat' ? <Plus className="size-4" /> : <FolderPlus className="size-4" />}
            {mode === 'chat' ? 'New chat' : 'Create workspace'}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
          <div className="mb-3 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            <span>{mode === 'chat' ? 'Chats' : 'Workspace Library'}</span>
            {mode === 'chat' && loadingGeneralChats ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {mode === 'workspaces' && loadingWorkspaces ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 pr-3">
              {mode === 'chat' ? (
                loadingGeneralChats ? null : generalChats.length === 0 ? (
                  <Card className="rounded-[24px] bg-[var(--surface-soft)]/70 p-4 text-sm text-[var(--text-secondary)]">No chats yet.</Card>
                ) : (
                  generalChats.map(conversation => (
                    <Card
                      key={conversation._id}
                      className={[
                        'rounded-[24px] border-transparent bg-transparent transition hover:border-[var(--border)] hover:bg-[var(--surface-soft)]/70',
                        location.pathname === `/chat/${conversation._id}` ? 'border-[var(--border)] bg-[var(--surface-soft)]/70' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2 p-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded-[18px] px-3 py-2 text-left"
                          onClick={() => navigate(`/chat/${conversation._id}`)}
                        >
                          <span className="line-clamp-2 text-sm font-medium text-[var(--text-primary)]">{conversation.title}</span>
                          <span className="text-xs text-[var(--text-secondary)]">{formatRelativeDate(conversation.updated_at)}</span>
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
                      </div>
                    </Card>
                  ))
                )
              ) : loadingWorkspaces ? null : workspaces.length === 0 ? (
                <Card className="rounded-[24px] bg-[var(--surface-soft)]/70 p-4 text-sm text-[var(--text-secondary)]">No workspaces yet.</Card>
              ) : (
                workspaces.map(workspace => (
                  <button key={workspace.id} type="button" className="block w-full text-left" onClick={() => navigate(`/workspaces/${workspace.id}`)}>
                    <Card
                      className={[
                        'rounded-[24px] p-4 transition hover:border-[var(--border)] hover:bg-[var(--surface-soft)]/70',
                        location.pathname.includes(workspace.id) ? 'border-[var(--border)] bg-[var(--surface-soft)]/70' : 'bg-transparent',
                      ].join(' ')}
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{workspace.title}</div>
                        <div className="text-xs text-[var(--text-secondary)]">{formatRelativeDate(workspace.updated_at)}</div>
                      </div>
                    </Card>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="border-t border-[var(--border)] p-4">
          {actionError ? <p className="mb-3 text-xs text-[var(--danger)]">{actionError}</p> : null}
          <Button variant="secondary" className="w-full justify-start" onClick={() => setTheme(current => (current === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <SunMedium className="size-4" /> : <Moon className="size-4" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </Button>
        </div>
      </aside>

      <Dialog open={!!renameTarget} onOpenChange={open => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>Update the chat title while keeping its messages and token history intact.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <Input value={renameDraft} onChange={event => setRenameDraft(event.target.value)} autoFocus />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleRename()}>Save</Button>
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
                void handleDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
