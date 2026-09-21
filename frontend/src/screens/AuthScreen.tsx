import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Wordmark } from '../components/Wordmark';
import { Button } from '../components/ui/button';
import { InlineAlert, Spinner } from '../components/ui/feedback';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';

type Mode = 'login' | 'register';

const COPY: Record<
  Mode,
  { title: string; submit: string; switchPrompt: string; switchTo: string }
> = {
  login: {
    title: 'Sign in to your manuscripts',
    submit: 'Sign in',
    switchPrompt: 'New to Maya?',
    switchTo: 'Create an account',
  },
  register: {
    title: 'Create your account',
    submit: 'Create account',
    switchPrompt: 'Already have an account?',
    switchTo: 'Sign in',
  },
};

export function AuthScreen() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const copy = COPY[mode];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError(null);
  };

  return (
    <main className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[22rem]">
        <div className="mb-8 text-center">
          <Wordmark className="text-4xl" />
          <p className="mt-2 font-serif text-[15px] text-ink-muted italic">
            A novel, one chapter at a time.
          </p>
        </div>

        <form
          onSubmit={submit}
          aria-labelledby="auth-title"
          className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 shadow-float"
        >
          <h1 id="auth-title" className="text-base font-semibold">
            {copy.title}
          </h1>

          <Field label="Email">
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
          </Field>

          <Field label="Password">
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
          </Field>

          {error && <InlineAlert className="rounded-control border">{error}</InlineAlert>}

          <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
            {busy && <Spinner />}
            {copy.submit}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-subtle">
          {copy.switchPrompt}{' '}
          <button
            type="button"
            onClick={toggle}
            className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
          >
            {copy.switchTo}
          </button>
        </p>
      </div>
    </main>
  );
}
