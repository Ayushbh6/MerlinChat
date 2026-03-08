import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatRelativeDate } from '../../api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { EmptyState, LoadingState, PageTitle } from '../../components/ui/state';
import type { Workspace } from '../../types';

export function WorkspaceIndexPage({
  workspaces,
  loading,
}: {
  workspaces: Workspace[];
  loading: boolean;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const filteredWorkspaces = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workspaces;

    return workspaces.filter(workspace => {
      const haystack = [
        workspace.title,
        workspace.description || '',
        workspace.subject_area || '',
        workspace.semester || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [workspaces, search]);

  return (
    <section className="space-y-8 py-4">
      <PageTitle
        eyebrow="Projects"
        title="Workspaces"
        copy="Open a project, ground a new conversation in uploaded files, and keep document-backed work organized in one place."
        actions={
          <Button onClick={() => navigate('/workspaces/new')}>
            <Plus className="size-4" />
            New project
          </Button>
        }
      />

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <Input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search projects"
          className="pl-11"
        />
      </div>

      {loading ? (
        <LoadingState label="Loading projects" />
      ) : filteredWorkspaces.length === 0 ? (
        <EmptyState title="No projects yet" copy="Create one to start grounding chats in uploaded files." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {filteredWorkspaces.map(workspace => (
            <button key={workspace.id} type="button" className="text-left" onClick={() => navigate(`/workspaces/${workspace.id}`)}>
              <Card className="h-full overflow-hidden transition hover:-translate-y-1 hover:border-[var(--ring)] hover:shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
                <CardContent className="flex h-full flex-col justify-between gap-8 p-6">
                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                      {workspace.subject_area || 'Workspace'}
                    </div>
                    <div className="space-y-2">
                      <h2 className="font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
                        {workspace.title}
                      </h2>
                      <p className="text-sm leading-7 text-[var(--text-secondary)]">
                        {workspace.description || 'Project documents, chats, and execution traces live here.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    <span>{workspace.semester || 'No semester set'}</span>
                    <span>{formatRelativeDate(workspace.updated_at)}</span>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

