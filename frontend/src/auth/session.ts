// Session plumbing for the (non-React) API layer. Clerk owns the session:
// getToken() waits for Clerk to load and hands back a short-lived token it
// refreshes itself, so nothing is stored here. A 401 still has to reach the
// router, which is what the unauthorized handler is for.

import { getToken } from '@clerk/react';

let unauthorizedHandler: (() => void) | null = null;

/** Authorization header for the signed-in writer, or {} when signed out. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** RequireAuth registers the sign-out-and-redirect behavior here. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

/** Called by the API layer when the backend refuses the session. */
export function handleUnauthorized(): void {
  unauthorizedHandler?.();
}
