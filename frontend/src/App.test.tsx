import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { clerk } from './test/clerk';

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('App routing', () => {
  it('sends a signed-out visitor to the sign-in form', () => {
    clerk.isSignedIn = false;
    renderAt('/');
    expect(screen.getByText('Clerk sign-in form')).toBeInTheDocument();
  });

  it('serves sign-up on its own path', () => {
    clerk.isSignedIn = false;
    renderAt('/sign-up');
    expect(screen.getByText('Clerk sign-up form')).toBeInTheDocument();
  });

  it('sends a signed-in writer from sign-in to their projects', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
    );
    renderAt('/sign-in');
    expect(screen.queryByText('Clerk sign-in form')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
