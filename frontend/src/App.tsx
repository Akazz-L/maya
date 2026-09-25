import { lazy, Suspense, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { RequireAuth } from './components/RequireAuth';
import { Spinner } from './components/ui/feedback';
import { AuthScreen } from './screens/AuthScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';

// The workspace carries the editor (CodeMirror, the diff engine): most of the
// bundle. Loaded on the way into a project, so sign-in and the project list
// never download it.
const WorkspaceScreen = lazy(() =>
  import('./screens/WorkspaceScreen').then((m) => ({ default: m.WorkspaceScreen })),
);

function ScreenFallback() {
  return (
    <div role="status" aria-label="Loading" className="flex h-full items-center justify-center">
      <Spinner className="text-ink-faint" />
    </div>
  );
}

/** Cached queries belong to whoever fetched them; drop them when the account changes. */
function useClearCacheOnAccountChange(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  const last = useRef(userId);
  useEffect(() => {
    if (last.current !== userId) queryClient.clear();
    last.current = userId;
  }, [userId, queryClient]);
}

export function App() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  useClearCacheOnAccountChange(userId);
  if (!isLoaded) return <ScreenFallback />;
  const home = isSignedIn ? '/' : '/sign-in';
  return (
    <Suspense fallback={<ScreenFallback />}>
      <Routes>
        <Route
          path="/sign-in/*"
          element={isSignedIn ? <Navigate to="/" replace /> : <AuthScreen mode="sign-in" />}
        />
        <Route
          path="/sign-up/*"
          element={isSignedIn ? <Navigate to="/" replace /> : <AuthScreen mode="sign-up" />}
        />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ProjectsScreen />} />
          <Route path="/p/:projectId" element={<WorkspaceScreen />} />
          <Route path="/p/:projectId/d/:documentId" element={<WorkspaceScreen />} />
        </Route>
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Suspense>
  );
}
