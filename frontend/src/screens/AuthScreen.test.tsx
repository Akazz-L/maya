import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthScreen } from './AuthScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken, getToken } from '../auth/token';

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <AuthScreen />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe('AuthScreen', () => {
  it('signs in and stores the token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ access_token: 'jwt123', token_type: 'bearer' }));

    renderScreen();
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(getToken()).toBe('jwt123'));
    expect(fetchSpy.mock.calls[0][0]).toBe('/auth/token');
  });

  it('shows the backend error message on bad credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ detail: 'Invalid credentials' }, 401),
    );

    renderScreen();
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
