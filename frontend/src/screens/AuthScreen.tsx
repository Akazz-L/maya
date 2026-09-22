import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Wordmark } from '../components/Wordmark';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/field';

type Mode = 'login' | 'register';

const COPY: Record<Mode, { title: string; submit: string; switch: string }> = {
  login: {
    title: 'Sign in',
    submit: 'Sign in',
    switch: "Don't have an account? Create one",
  },
  register: {
    title: 'Create account',
    submit: 'Create account',
    switch: 'Already have an account? Sign in',
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
      <div className="rounded-sm bg-paper px-9 py-10 shadow-paper">
        <p className="font-serif text-[17px] leading-[1.9] text-ink">
          The salt road ran{' '}
          <span className="rounded-sm bg-[var(--del-bg)] px-0.5 text-[var(--del-fg)] line-through decoration-1">
            east
          </span>
          <span className="rounded-sm bg-[var(--ins-bg)] px-0.5 text-[var(--ins-fg)]">west</span>{' '}
          for three days before it gave out in the marsh, and nobody who walked it came back with
          the same name.
        </p>
        <p className="mt-4 font-serif text-[17px] leading-[1.9] text-ink-3">
          Ines had walked it twice.
        </p>
      </div>
      <figcaption className="absolute -right-6 -bottom-8 w-60 rounded-xl border border-ai-line bg-raised p-3.5 shadow-pop">
        <span className="flex items-center gap-2 text-xs font-semibold text-ai-ink">
          <span className="size-1.5 rounded-full bg-ai" />
          Continuity check
        </span>
        <span className="mt-1 block text-[13px] leading-snug text-ink-2">
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
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError(null);
  };

  const copy = COPY[mode];

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-desk p-12 lg:flex">
        <Wordmark className="text-2xl" />
        <div className="flex flex-1 items-center py-12">
          <ManuscriptSample />
        </div>
        <div>
          <p className="max-w-sm text-[15px] leading-relaxed text-ink-2">
            Write a novel one chapter at a time. The assistant drafts and checks your work, and
            every change it suggests waits for you to accept it.
          </p>
        </div>
      </section>

      <main className="flex items-center justify-center bg-paper px-4 py-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <Wordmark className="text-2xl lg:hidden" />
          <h1 className="font-serif text-3xl font-semibold tracking-tight">{copy.title}</h1>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email">
              <Input
                type="email"
                aria-label="Email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                aria-label="Password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {error && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            )}

            <Button type="submit" size="full" disabled={pending} className="mt-2">
              {pending ? 'Please wait…' : copy.submit}
            </Button>
          </form>

          <button
            type="button"
            onClick={toggleMode}
            className="self-start text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink-3"
          >
            {copy.switch}
          </button>
        </div>
      </main>
    </div>
  );
}
