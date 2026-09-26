import { useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { Navigate, Outlet } from 'react-router-dom';
import { setUnauthorizedHandler } from '../auth/session';

/** Gate for protected routes: redirects to /sign-in when there is no session. */
export function RequireAuth() {
  const { isSignedIn, signOut } = useAuth();

  // The backend refusing a session Clerk still holds (revoked elsewhere, or
  // minted for another origin) ends it here too, rather than leaving the app
  // signed in to nothing.
  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  return isSignedIn ? <Outlet /> : <Navigate to="/sign-in" replace />;
}
