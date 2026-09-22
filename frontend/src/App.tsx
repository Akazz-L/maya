import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { AuthScreen } from './screens/AuthScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';

// The workspace carries the editor (CodeMirror, the diff engine); loading it on
// demand keeps sign-in and the project list light.
const WorkspaceScreen = lazy(() =>
  import('./screens/WorkspaceScreen').then((m) => ({ default: m.WorkspaceScreen })),
);

function LazyOutlet() {
  return (
    <Suspense fallback={<div className="h-screen bg-desk" aria-busy="true" />}>
      <Outlet />
    </Suspense>
  );
}

export function App() {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <AuthScreen />}
      />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<ProjectsScreen />} />
        <Route element={<LazyOutlet />}>
          <Route path="/p/:projectId" element={<WorkspaceScreen />} />
          <Route path="/p/:projectId/d/:documentId" element={<WorkspaceScreen />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={isAuthenticated ? '/' : '/login'} replace />} />
    </Routes>
  );
}
