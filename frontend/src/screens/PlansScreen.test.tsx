import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PlansScreen } from './PlansScreen';
import type { CurrentPlan, PlanOption } from '../api/types';
import { goTo } from '../lib/navigation';

vi.mock('../lib/navigation', () => ({ goTo: vi.fn() }));

const PLANS: PlanOption[] = [
  { key: 'free', label: 'Free', price_usd: 0, budget_usd: 5 },
  { key: 'starter', label: 'Starter', price_usd: 20, budget_usd: 10 },
  { key: 'pro', label: 'Pro', price_usd: 50, budget_usd: 25 },
  { key: 'studio', label: 'Studio', price_usd: 100, budget_usd: 50 },
];

const FREE: CurrentPlan = { key: 'free', label: 'Free', ends_at: null };
const PRO: CurrentPlan = { key: 'pro', label: 'Pro', ends_at: null };

function json(data: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A backend whose writer is on `plan` until /billing/sync moves them to `afterSync`. */
function mockBackend(plan: CurrentPlan, afterSync: CurrentPlan = plan) {
  let current = plan;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/billing/plans') return json(PLANS);
    if (url === '/billing/checkout') return json({ url: 'https://checkout.stripe.test/c/1' });
    if (url === '/billing/portal') return json({ url: 'https://billing.stripe.test/p/1' });
    if (url === '/billing/sync' && init?.method === 'POST') {
      current = afterSync;
      return json(null, 204);
    }
    if (url === '/me') {
      return json({
        model_key: 'haiku',
        models: [],
        plan: current,
        usage: { spent_usd: 0, budget_usd: 5, percent: 0, blocked: false, period_end: '' },
      });
    }
    throw new Error(`unexpected ${url}`);
  });
}

function Location() {
  return <p data-testid="location">{useLocation().search}</p>;
}

function renderAt(path = '/plans') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route
            path="/plans"
            element={
              <>
                <PlansScreen />
                <Location />
              </>
            }
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(goTo).mockClear();
});

describe('PlansScreen', () => {
  it('lists every plan with its price and the AI use it includes', async () => {
    mockBackend(FREE);
    renderAt();

    const cards = await screen.findAllByRole('listitem');
    expect(cards.map((c) => c.querySelector('h2')?.textContent)).toEqual([
      'Free',
      'Starter',
      'Pro',
      'Studio',
    ]);
    expect(cards[2]).toHaveTextContent('$50 / month');
    expect(cards[2]).toHaveTextContent('$25 of AI use each month');
    expect(cards[0]).toHaveAttribute('aria-current', 'true');
  });

  it('sends a free writer to Stripe checkout for the plan they pick', async () => {
    const fetchSpy = mockBackend(FREE);
    renderAt();

    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }));

    await waitFor(() => expect(goTo).toHaveBeenCalledWith('https://checkout.stripe.test/c/1'));
    const checkout = fetchSpy.mock.calls.find(([url]) => url === '/billing/checkout');
    expect(JSON.parse(checkout?.[1]?.body as string)).toEqual({ plan: 'pro' });
  });

  it('sends a subscriber to the billing portal to manage or change plans', async () => {
    mockBackend(PRO);
    renderAt();

    // Starter and Studio both switch through the portal.
    expect(await screen.findAllByRole('button', { name: 'Switch in billing' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Manage billing' }));

    await waitFor(() => expect(goTo).toHaveBeenCalledWith('https://billing.stripe.test/p/1'));
  });

  it('says when a cancelled plan ends', async () => {
    mockBackend({ ...PRO, ends_at: '2026-10-14T12:00:00+00:00' });
    renderAt();
    expect(await screen.findByText('Ends October 14, then Free.')).toBeInTheDocument();
  });

  it('confirms the new plan on the way back from checkout', async () => {
    const fetchSpy = mockBackend(FREE, PRO);
    renderAt('/plans?checkout=success');

    expect(await screen.findByText(/You're on Pro\./)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/billing/sync')).toHaveLength(1);
    // The query string is dropped so a reload doesn't sync again.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(''));
  });

  it('shows why a checkout could not start', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/billing/plans') return json(PLANS);
      if (url === '/me') return json({ model_key: 'haiku', models: [], plan: FREE, usage: {} });
      return json({ detail: 'Billing is not enabled.' }, 503);
    });
    renderAt();

    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to Starter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Billing is not enabled.');
    expect(goTo).not.toHaveBeenCalled();
  });
});
