import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { ProjectSummary } from '../api/types';
import { AccountMenu } from '../components/AccountMenu';
import { Wordmark } from '../components/Wordmark';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/field';
import { useCreateProject, useProjects } from '../hooks/queries';

const started = (iso: string) =>
  // In the interface's language, so the date reads as part of the sentence around it.
  new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });

/** A project as the title page of its manuscript. */
function TitlePage({ project }: { project: ProjectSummary }) {
  return (
    <Link
      to={`/p/${project.project_id}`}
      className="group flex aspect-[4/5] flex-col items-center justify-center gap-4 rounded-sm bg-paper px-6 text-center shadow-paper transition-transform duration-200 hover:-translate-y-1"
    >
      <span className="line-clamp-4 font-serif text-xl leading-snug font-semibold text-balance text-ink group-hover:text-accent-ink">
        {project.name}
      </span>
      <span className="h-px w-8 bg-line" aria-hidden />
      <span className="text-xs text-ink-3">Started {started(project.created_at)}</span>
    </Link>
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
    if (trimmed)
      create.mutate(trimmed, { onSuccess: (res) => navigate(`/p/${res.project_id}`) });
  };

  return (
    <div className="min-h-screen bg-desk">
      <header className="flex h-14 items-center justify-between px-4 sm:px-8">
        <Wordmark />
        <AccountMenu />
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 pt-10 pb-20 sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="font-serif text-4xl font-semibold tracking-tight">Your projects</h1>
          <form onSubmit={submitNew} className="flex w-full gap-2 sm:w-auto">
            <Input
              aria-label="New project name"
              placeholder="Name a new project…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-paper sm:w-64"
            />
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              <Plus aria-hidden />
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
        </div>

        {create.isError && (
          <p role="alert" className="text-sm text-danger">
            {create.error.message}
          </p>
        )}

        {projects.isPending && (
          <ul aria-label="Loading projects" className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <li key={i} className="aspect-[4/5] animate-pulse rounded-sm bg-surface" />
            ))}
          </ul>
        )}
        {projects.isError && (
          <p role="alert" className="text-sm text-danger">
            {projects.error.message}
          </p>
        )}
        {projects.data?.length === 0 && (
          <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-line px-8 py-12">
            <p className="font-serif text-xl">No projects yet.</p>
            <p className="text-sm text-ink-2">
              Name one above to begin. Each project starts with a story bible and room for
              chapters.
            </p>
          </div>
        )}

        {!!projects.data?.length && (
          <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {projects.data.map((p) => (
              <li key={p.project_id}>
                <TitlePage project={p} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
