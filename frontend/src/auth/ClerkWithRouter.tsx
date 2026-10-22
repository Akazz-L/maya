import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/react';
import { useNavigate } from 'react-router-dom';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!PUBLISHABLE_KEY) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set. Add it to the .env at the repo root.');
}

/** Clerk's forms take the brand tokens from index.css, so dark mode applies to them too. */
const APPEARANCE = {
  variables: {
    colorPrimary: 'var(--color-brand)',
    colorBackground: 'var(--color-surface)',
    colorText: 'var(--color-ink)',
    colorTextSecondary: 'var(--color-ink-muted)',
    colorTextOnPrimaryBackground: 'var(--color-on-accent)',
    colorInputBackground: 'var(--color-surface)',
    colorInputText: 'var(--color-ink)',
    colorDanger: 'var(--color-danger)',
    fontFamily: 'var(--font-sans)',
  },
};

/** Clerk, navigating through React Router so its redirects stay client-side. */
export function ClerkWithRouter({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={APPEARANCE}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
    >
      {children}
    </ClerkProvider>
  );
}
