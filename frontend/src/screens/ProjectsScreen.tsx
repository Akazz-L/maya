import { useState, type FormEvent } from 'react';
import { BookOpen, ChevronRight, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '../api/types';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/ui/button';
import { EmptyState, InlineAlert, Skeleton, Spinner } from '../components/ui/feedback';
import { Input } from '../components/ui/input';
import { useCreateProject, useProjects } from '../hooks/queries';

const formatCreated = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function ProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <li>
      <Link
        to={`/p/${project.project_id}`}
        className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted"
      >
        <BookOpen aria-hidden className="size-4 shrink-0 text-ink-subtle" />
        <span className="min-w-0 flex-1 truncate font-serif text-[17px] font-medium text-ink">
          {project.name}
        </span>
        <span className="hidden shrink-0 text-xs text-ink-subtle sm:block">
          Started {formatCreated(project.created_at)}
        </span>
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink-subtle"
        />
      </Link>
    </li>
  );
}

function ProjectListSkeleton() {
  return (
    <div role="status" aria-label="Loading projects" className="divide-y divide-line">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-48" />
        </div>
      ))}
    </div>
  );
}

export function ProjectsScreen() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const projects = useProjects();
  const create = useCreateProject();

  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) create.mutate(trimmed, { onSuccess: (res) => navigate(`/p/${res.project_id}`) });
  };

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader />

      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
        <h1 className="font-serif text-3xl font-semibold tracking-[-0.01em]">Your projects</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Each project holds a story bible, its chapters, and your notes.
        </p>

        <form onSubmit={submitNew} className="mt-8 flex gap-2">
          <label htmlFor="new-project" className="sr-only">
            New project name
          </label>
          <Input
            id="new-project"
            placeholder="Name a new project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={create.isError || undefined}
          />
          <Button type="submit" size="lg" disabled={create.isPending || !name.trim()}>
            {create.isPending ? <Spinner /> : <Plus aria-hidden />}
            <span className="hidden sm:inline">Create project</span>
            <span className="sm:hidden">Create</span>
          </Button>
        </form>
        {create.isError && (
          <InlineAlert className="mt-2 rounded-control border">{create.error.message}</InlineAlert>
        )}

        <section
          aria-label="Projects"
          className="mt-6 overflow-hidden rounded-panel border border-line bg-surface"
        >
          {projects.isPending ? (
            <ProjectListSkeleton />
          ) : projects.isError ? (
            <EmptyState
              title="Couldn't load your projects"
              action={
                <Button variant="secondary" onClick={() => void projects.refetch()}>
                  Try again
                </Button>
              }
            >
              {projects.error.message}
            </EmptyState>
          ) : projects.data.length === 0 ? (
            <EmptyState icon={<BookOpen />} title="No projects yet">
              Name your first one above. It starts with a story bible, ready for your characters and
              world.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {projects.data.map((p) => (
                <ProjectRow key={p.project_id} project={p} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
