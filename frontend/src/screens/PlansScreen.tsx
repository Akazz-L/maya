import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { openBillingPortal, startCheckout, syncBilling } from '../api/endpoints';
import type { CurrentPlan, PlanOption } from '../api/types';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/ui/button';
import { EmptyState, InlineAlert, Skeleton, Spinner } from '../components/ui/feedback';
import { meKey, useMe, usePlans } from '../hooks/queries';
import { goTo } from '../lib/navigation';
import { cn } from '../lib/utils';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { month: 'long', day: 'numeric' });

const formatBudget = (usd: number) => `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;

interface CardProps {
  plan: PlanOption;
  current: CurrentPlan;
  busy: boolean;
  onUpgrade: (key: string) => void;
  onManage: () => void;
}

function PlanCard({ plan, current, busy, onUpgrade, onManage }: CardProps) {
  const isCurrent = plan.key === current.key;
  const onPaidPlan = current.key !== 'free';

  let action;
  if (isCurrent) {
    action = onPaidPlan ? (
      <Button variant="secondary" className="w-full" disabled={busy} onClick={onManage}>
        Manage billing
      </Button>
    ) : (
      <p className="flex h-8 items-center justify-center gap-1.5 text-sm text-ink-subtle">
        <Check aria-hidden className="size-4" /> Your plan
      </p>
    );
  } else if (onPaidPlan) {
    // Changing between paid plans, or back to Free, goes through Stripe's
    // portal: it swaps the price on the one subscription and prorates.
    action = (
      <Button variant="secondary" className="w-full" disabled={busy} onClick={onManage}>
        {plan.key === 'free' ? 'Cancel in billing' : 'Switch in billing'}
      </Button>
    );
  } else if (plan.key !== 'free') {
    action = (
      <Button className="w-full" disabled={busy} onClick={() => onUpgrade(plan.key)}>
        Upgrade to {plan.label}
      </Button>
    );
  }

  return (
    <li
      aria-current={isCurrent || undefined}
      className={cn(
        'flex flex-col gap-4 rounded-panel border bg-surface p-5 shadow-float',
        isCurrent ? 'border-ink' : 'border-line',
      )}
    >
      <div>
        <h2 className="font-serif text-xl font-semibold text-ink">{plan.label}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {plan.price_usd === 0 ? (
            'No card needed'
          ) : (
            <>
              <span className="text-2xl font-semibold text-ink tabular-nums">
                ${plan.price_usd}
              </span>{' '}
              / month
            </>
          )}
        </p>
      </div>
      <p className="flex-1 text-sm text-ink">
        <span className="font-medium tabular-nums">{formatBudget(plan.budget_usd)}</span> of AI use
        each month, on any model.
      </p>
      {isCurrent && current.ends_at && (
        <p className="text-xs text-warning">Ends {formatDate(current.ends_at)}, then Free.</p>
      )}
      <div>{action}</div>
    </li>
  );
}

export function PlansScreen() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useMe();
  const plans = usePlans();
  const [error, setError] = useState<string | null>(null);

  const redirect = useMutation({
    mutationFn: (to: { checkout: string } | 'portal') =>
      to === 'portal' ? openBillingPortal() : startCheckout(to.checkout),
    onSuccess: ({ url }) => goTo(url),
    onError: (e) => setError(e.message),
  });

  // Back from checkout, the webhook may not have landed yet: ask Stripe directly.
  const returning = params.get('checkout') === 'success';
  const synced = useRef(false);
  const sync = useMutation({
    mutationFn: syncBilling,
    onSettled: () => qc.invalidateQueries({ queryKey: meKey }),
  });
  useEffect(() => {
    if (!returning || synced.current) return;
    synced.current = true;
    sync.mutate(undefined, { onSettled: () => navigate('/plans', { replace: true }) });
  }, [returning, sync, navigate]);

  const busy = redirect.isPending || sync.isPending;
  const upgraded = sync.isSuccess && me.data && me.data.plan.key !== 'free';

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader title="Plans" />

      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="font-serif text-4xl font-semibold tracking-[-0.01em]">Plans</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Every plan has every feature and all three models. They differ in how much AI use each
            month includes.
          </p>
        </div>

        <div className="mx-auto mt-6 max-w-lg" aria-live="polite">
          {sync.isPending && (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-muted">
              <Spinner /> Confirming your subscription…
            </p>
          )}
          {upgraded && (
            <p className="text-center text-sm font-medium text-ink">
              You're on {me.data.plan.label}. Thank you for supporting Maya.
            </p>
          )}
          {error && (
            <InlineAlert className="rounded-control border" onDismiss={() => setError(null)}>
              {error}
            </InlineAlert>
          )}
        </div>

        <section aria-label="Plans" className="mt-8">
          {plans.isPending || me.isPending ? (
            <div role="status" aria-label="Loading plans" className="grid gap-4 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-56 rounded-panel" />
              ))}
            </div>
          ) : plans.isError || me.isError ? (
            <EmptyState
              title="Couldn't load plans"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    void plans.refetch();
                    void me.refetch();
                  }}
                >
                  Try again
                </Button>
              }
            >
              {(plans.error ?? me.error)?.message}
            </EmptyState>
          ) : (
            <ul
              className={cn(
                'grid gap-4',
                // Free alone, while billing is off, sits centred rather than in a half-empty row.
                plans.data.length === 1 ? 'mx-auto max-w-sm' : 'sm:grid-cols-2',
                plans.data.length > 2 && 'lg:grid-cols-4',
              )}
            >
              {plans.data.map((plan) => (
                <PlanCard
                  key={plan.key}
                  plan={plan}
                  current={me.data.plan}
                  busy={busy}
                  onUpgrade={(key) => redirect.mutate({ checkout: key })}
                  onManage={() => redirect.mutate('portal')}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
