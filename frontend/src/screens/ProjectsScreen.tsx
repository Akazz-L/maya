import { useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '../api/types';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/ui/button';
import { EmptyState, InlineAlert, Skeleton, Spinner } from '../components/ui/feedback';
import { Input } from '../components/ui/input';
import { useCreateProject, useProjects } from '../hooks/queries';

// In the interface's language, so the date reads as part of the sentence around it.
const formatCreated = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });

/** A project as the title page of its manuscript. */
function TitlePage({ project }: { project: ProjectSummary }) {
  return (
    <Link
      to={`/p/${project.project_id}`}
      className="group flex aspect-[4/5] flex-col items-center justify-center gap-4 rounded-panel border border-line bg-surface px-6 text-center shadow-float transition-transform duration-200 hover:-translate-y-1"
    >
      <span className="line-clamp-4 font-serif text-xl leading-snug font-semibold text-balance text-ink">
        {project.name}
      </span>
      <span aria-hidden className="h-px w-8 bg-line-strong" />
      <span className="text-xs text-ink-subtle">Started {formatCreated(project.created_at)}</span>
    </Link>
  );
}

function ProjectGridSkeleton() {
  return (
    // The status role sits on the wrapper: on the list itself it would replace
    // the list semantics the cards rely on.
    <div role="status" aria-label="Loading projects">
      <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton className="aspect-[4/5] w-full rounded-panel" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Empty and error states need the panel the grid does not: alone they have no edges. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface">{children}</div>
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

      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <h1 className="font-serif text-4xl font-semibold tracking-[-0.01em]">Your projects</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Each project holds a story bible, its chapters, and your notes.
          </p>

          <form onSubmit={submitNew} className="mt-8 flex w-full gap-2">
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
            <InlineAlert className="mt-2 w-full rounded-control border">
              {create.error.message}
            </InlineAlert>
          )}
        </div>

        <section aria-label="Projects" className="mt-12">
          {projects.isPending ? (
            <ProjectGridSkeleton />
          ) : projects.isError ? (
            <Notice>
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
            </Notice>
          ) : projects.data.length === 0 ? (
            <Notice>
              <EmptyState icon={<BookOpen />} title="No projects yet">
                Name your first one above. It starts with a story bible, ready for your characters
                and world.
              </EmptyState>
            </Notice>
          ) : (
            <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
              {projects.data.map((p) => (
                <li key={p.project_id}>
                  <TitlePage project={p} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
