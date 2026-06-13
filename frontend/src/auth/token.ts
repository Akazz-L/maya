// JWT storage + a global "unauthorized" hook. The token lives in localStorage
// so the session survives reloads (key `maya.token`). The API layer is not a
// React component, so it can't navigate on a 401 directly; instead it calls
// handleUnauthorized(), and AuthProvider registers a handler that logs out.

const TOKEN_KEY = 'maya.token';

let unauthorizedHandler: (() => void) | null = null;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Authorization header for authed requests, or {} when signed out. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** AuthProvider registers the logout-and-redirect behavior here. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

/** Called by the API layer on a 401: clear the token and notify the app. */
export function handleUnauthorized(): void {
  clearToken();
  unauthorizedHandler?.();
}
