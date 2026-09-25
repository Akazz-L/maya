import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AccountMenu } from './AccountMenu';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken, getToken, setToken } from '../auth/token';

function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <AccountMenu />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function mockMe(email: string) {
  // A fresh Response per call: a body can only be read once.
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ email, model_key: 'sonnet', models: [], usage: { spent: 0, limit: 0 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe('AccountMenu', () => {
  it('shows the first letter of the signed-in email', async () => {
    mockMe('writer@example.com');
    renderMenu();
    // It renders a placeholder until the account arrives, so wait for the letter.
    const trigger = await screen.findByRole('button', { name: 'Account' });
    await waitFor(() => expect(trigger).toHaveTextContent('W'));
  });

  it('opens a menu listing the account and logs out', async () => {
    setToken('jwt123');
    mockMe('writer@example.com');
    renderMenu();

    await userEvent.click(await screen.findByRole('button', { name: 'Account' }));

    expect(screen.getByText('writer@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /log out/i }));

    expect(getToken()).toBeNull();
  });
});
