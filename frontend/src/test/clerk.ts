// A stand-in for @clerk/react, installed for every test by setup.ts. Tests
// steer it through `clerk`: who is signed in, and the token API calls carry.

import { createElement } from 'react';
import { vi } from 'vitest';

export const clerk = {
  isSignedIn: true,
  userId: 'user_test' as string | null,
  email: 'writer@example.com',
  token: 'clerk-session-token' as string | null,
  signOut: vi.fn(async () => {}),
  openUserProfile: vi.fn(),
};

export function resetClerk(): void {
  clerk.isSignedIn = true;
  clerk.userId = 'user_test';
  clerk.email = 'writer@example.com';
  clerk.token = 'clerk-session-token';
  clerk.signOut.mockClear();
  clerk.openUserProfile.mockClear();
}

export const clerkModule = {
  getToken: async () => (clerk.isSignedIn ? clerk.token : null),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: clerk.isSignedIn,
    userId: clerk.isSignedIn ? clerk.userId : null,
    signOut: clerk.signOut,
  }),
  useClerk: () => ({ signOut: clerk.signOut, openUserProfile: clerk.openUserProfile }),
  useUser: () => ({
    isLoaded: true,
    user: clerk.isSignedIn ? { primaryEmailAddress: { emailAddress: clerk.email } } : null,
  }),
  SignIn: () => createElement('div', null, 'Clerk sign-in form'),
  SignUp: () => createElement('div', null, 'Clerk sign-up form'),
};
