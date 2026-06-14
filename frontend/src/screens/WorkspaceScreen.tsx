import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { getProject } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ChapterPanel } from '../components/ChapterPanel';
import { NavBar, type View } from '../components/NavBar';
import { Button } from '../components/ui/button';
import { StoryBiblePage } from './StoryBiblePage';

export function WorkspaceScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('write');

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  if (!projectId) return <Navigate to="/" replace />;
  if (project.isError) return <Navigate to="/" replace />;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f0]">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            ← Projects
          </Button>
          <h1 className="text-base font-semibold text-gray-800">
            {project.data?.name ?? '…'}
          </h1>
        </div>
        <Button variant="secondary" size="sm" onClick={logout}>
          Log out
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <NavBar view={view} onViewChange={setView} />
        {view === 'write' ? (
          <ChapterPanel projectId={projectId} />
        ) : (
          <StoryBiblePage projectId={projectId} activeSection={view} />
        )}
      </div>
    </div>
  );
}
