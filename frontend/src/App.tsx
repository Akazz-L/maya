import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
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

export function App() {
  const { isAuthenticated } = useAuth();
  return (
    <Suspense fallback={<ScreenFallback />}>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/" replace /> : <AuthScreen />}
        />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ProjectsScreen />} />
          <Route path="/p/:projectId" element={<WorkspaceScreen />} />
          <Route path="/p/:projectId/d/:documentId" element={<WorkspaceScreen />} />
        </Route>
        <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}
