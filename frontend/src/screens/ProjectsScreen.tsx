import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createProject, listProjects } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export function ProjectsScreen() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const projects = useQuery({ queryKey: ['projects'], queryFn: listProjects });

  const create = useMutation({
    mutationFn: (projectName: string) => createProject(projectName),
    onSuccess: (res) => navigate(`/p/${res.project_id}`),
  });

  const submitNew = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) create.mutate(trimmed);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-base font-semibold text-gray-800">Your projects</h1>
        <Button variant="secondary" size="sm" onClick={logout}>
          Log out
        </Button>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
        <form onSubmit={submitNew} className="flex gap-2">
          <Input
            placeholder="New project name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </form>
        {create.isError && (
          <p className="text-xs text-red-700">{(create.error as Error).message}</p>
        )}

        {projects.isLoading && <p className="text-sm text-gray-400">Loading projects…</p>}
        {projects.isError && (
          <p className="text-sm text-red-700">{(projects.error as Error).message}</p>
        )}
        {projects.data && projects.data.length === 0 && (
          <p className="text-sm text-gray-400">No projects yet — create one to begin.</p>
        )}

        <ul className="flex flex-col gap-2">
          {projects.data?.map((p) => (
            <li key={p.project_id}>
              <button
                onClick={() => navigate(`/p/${p.project_id}`)}
                className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50"
              >
                <span className="font-medium text-gray-800">{p.name}</span>
                <span className="text-xs text-gray-400">
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
