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
    title: 'Sign in',
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

/**
 * What working in Maya looks like, drawn from the product itself: a line of
 * manuscript with a proposed fix marked where it applies, and the note that
 * explains it. Decorative, so hidden from assistive tech.
 */
function ManuscriptSample() {
  return (
    <figure aria-hidden className="relative max-w-md select-none">
      <div className="rounded-panel bg-surface px-9 py-10 shadow-float">
        <p className="font-serif text-[17px] leading-[1.9] text-ink">
          The salt road ran{' '}
          <span className="rounded-[3px] bg-diff-del-bg px-0.5 text-diff-del line-through decoration-1">
            east
          </span>
          <span className="rounded-[3px] bg-diff-ins-bg px-0.5 text-diff-ins">west</span> for three
          days before it gave out in the marsh, and nobody who walked it came back with the same
          name.
        </p>
        <p className="mt-4 font-serif text-[17px] leading-[1.9] text-ink-subtle">
          Ines had walked it twice.
        </p>
      </div>
      <figcaption className="absolute -right-6 -bottom-8 w-60 rounded-panel border border-pencil-line bg-surface p-3.5 shadow-float">
        <span className="flex items-center gap-2 text-xs font-semibold text-pencil">
          <span className="size-1.5 rounded-full bg-pencil" />
          Continuity check
        </span>
        <span className="mt-1 block text-[13px] leading-snug text-ink-muted">
          The story bible puts the marsh west of Harrow.
        </span>
      </figcaption>
    </figure>
  );
}

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
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-canvas p-12 lg:flex">
        <Wordmark className="text-2xl" />
        <div className="flex flex-1 items-center py-12">
          <ManuscriptSample />
        </div>
        <p className="max-w-sm text-[15px] leading-relaxed text-ink-muted">
          Write a novel one chapter at a time. The assistant drafts and checks your work, and every
          change it suggests waits for you to accept it.
        </p>
      </section>

      <main className="flex items-center justify-center bg-surface px-4 py-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <Wordmark className="text-2xl lg:hidden" />

          <form onSubmit={submit} aria-labelledby="auth-title" className="flex flex-col gap-4">
            <h1
              id="auth-title"
              className="font-serif text-3xl font-semibold tracking-[-0.01em] text-ink"
            >
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
                  autoFocus
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

            <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
              {busy && <Spinner />}
              {copy.submit}
            </Button>
          </form>

          <p className="text-sm text-ink-subtle">
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
    </div>
  );
}
