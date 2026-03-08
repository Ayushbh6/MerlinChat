import { useState } from 'react';
import { ArrowLeft, FileText, FolderPlus, Plus, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createWorkspaceWithAttachments, formatBytes } from '../../api';
import { createClientId } from '../../app/helpers';
import type { WorkspaceRouteState } from '../../app/types';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { EmptyState, ErrorBanner, PageTitle } from '../../components/ui/state';
import { Textarea } from '../../components/ui/textarea';
import type { StagedWorkspaceNote } from '../../types';

export function CreateWorkspacePage({ onCreated }: { onCreated: () => Promise<void> }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    subject_area: '',
    semester: '',
  });
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [stagedNotes, setStagedNotes] = useState<StagedWorkspaceNote[]>([]);
  const [noteDraft, setNoteDraft] = useState({ title: '', body: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setStagedFiles(current => [...current, ...Array.from(list)]);
  }

  function addNote() {
    if (!noteDraft.title.trim()) return;

    setStagedNotes(current => [
      ...current,
      { id: createClientId('note'), title: noteDraft.title.trim(), body: noteDraft.body },
    ]);
    setNoteDraft({ title: '', body: '' });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { workspace, failures } = await createWorkspaceWithAttachments({
        ...form,
        files: stagedFiles,
        notes: stagedNotes,
      });
      await onCreated();
      navigate(`/workspaces/${workspace.id}`, {
        replace: true,
        state: {
          flashMessage:
            failures.length > 0
              ? `Workspace created, but some uploads failed: ${failures.join(' · ')}`
              : 'Workspace created successfully.',
        } satisfies WorkspaceRouteState,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-8 py-4">
      <Button variant="ghost" className="w-fit" onClick={() => navigate('/workspaces')}>
        <ArrowLeft className="size-4" />
        Back to projects
      </Button>

      <PageTitle
        eyebrow="Create Workspace"
        title="Build a new project space"
        copy="Define the workspace, stage files, and seed notes before the first grounded conversation begins."
      />

      {error ? <ErrorBanner message={error} /> : null}

      <form className="grid gap-6 xl:grid-cols-[1.25fr_1fr]" onSubmit={handleSubmit}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Details</p>
                <h2 className="font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">Workspace identity</h2>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Title</span>
                <Input
                  required
                  value={form.title}
                  onChange={event => setForm(current => ({ ...current, title: event.target.value }))}
                  placeholder="Visual Data Science"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Subject area</span>
                <Input
                  value={form.subject_area}
                  onChange={event => setForm(current => ({ ...current, subject_area: event.target.value }))}
                  placeholder="Data Science"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Semester</span>
                <Input
                  value={form.semester}
                  onChange={event => setForm(current => ({ ...current, semester: event.target.value }))}
                  placeholder="SS 2026"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Description</span>
                <Textarea
                  rows={5}
                  value={form.description}
                  onChange={event => setForm(current => ({ ...current, description: event.target.value }))}
                  placeholder="What should Atlas know about this workspace?"
                />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="items-center">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Attachments</p>
                <h2 className="font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">Files and notes</h2>
              </div>
              <label>
                <Button type="button" variant="secondary" asChild>
                  <span>
                    <Upload className="size-4" />
                    Add files
                  </span>
                </Button>
                <input type="file" multiple hidden onChange={event => addFiles(event.target.files)} />
              </label>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3">
                {stagedFiles.length === 0 ? (
                  <EmptyState title="No files staged yet" copy="Upload PDFs, images, presentations, or text files before creating the project." />
                ) : (
                  stagedFiles.map(file => (
                    <Card key={`${file.name}-${file.size}-${file.lastModified}`} className="rounded-3xl bg-[var(--surface-soft)]/70">
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div className="space-y-1">
                          <p className="font-medium text-[var(--text-primary)]">{file.name}</p>
                          <p className="text-sm text-[var(--text-secondary)]">{formatBytes(file.size)}</p>
                        </div>
                        <Upload className="size-4 text-[var(--text-tertiary)]" />
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>

              <div className="grid gap-4 rounded-[28px] border border-[var(--border)] bg-[var(--surface-soft)]/60 p-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Quick note</p>
                  <h3 className="font-heading text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Create a seeded text file</h3>
                </div>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">Note title</span>
                  <Input
                    value={noteDraft.title}
                    onChange={event => setNoteDraft(current => ({ ...current, title: event.target.value }))}
                    placeholder="project-brief.md"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">Note body</span>
                  <Textarea
                    rows={5}
                    value={noteDraft.body}
                    onChange={event => setNoteDraft(current => ({ ...current, body: event.target.value }))}
                    placeholder="Paste key definitions, instructions, or project notes."
                  />
                </label>
                <Button type="button" variant="secondary" className="w-fit" onClick={addNote}>
                  <Plus className="size-4" />
                  Add note
                </Button>
              </div>

              <div className="grid gap-3">
                {stagedNotes.length === 0 ? (
                  <EmptyState title="No notes staged yet" copy="Add a brief, rubric, or instructions as a text file before the project goes live." />
                ) : (
                  stagedNotes.map(note => (
                    <Card key={note.id} className="rounded-3xl bg-[var(--surface-soft)]/70">
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div className="space-y-1">
                          <p className="font-medium text-[var(--text-primary)]">{note.title}</p>
                          <p className="text-sm text-[var(--text-secondary)]">{note.body.length} chars</p>
                        </div>
                        <FileText className="size-4 text-[var(--text-tertiary)]" />
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Ready</p>
              <h2 className="font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">Create workspace</h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm leading-7 text-[var(--text-secondary)]">
              Files and notes upload immediately after the workspace is created. The new UI keeps these steps isolated so styling changes here won&apos;t leak into chat screens.
            </p>
            <Button type="submit" disabled={isSubmitting || !form.title.trim()} className="w-full">
              {isSubmitting ? <FolderPlus className="size-4 animate-pulse" /> : <FolderPlus className="size-4" />}
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </section>
  );
}

