import { SignIn, SignUp } from '@clerk/react';
import { Wordmark } from '../components/Wordmark';

type Mode = 'sign-in' | 'sign-up';

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

/** The sign-in and sign-up pages: Maya's pitch on the left, Clerk's form on the right. */
export function AuthScreen({ mode }: { mode: Mode }) {
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

      <main className="flex flex-col items-center justify-center gap-8 bg-surface px-4 py-12">
        <Wordmark className="text-2xl lg:hidden" />
        {mode === 'sign-in' ? (
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
        ) : (
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
        )}
      </main>
    </div>
  );
}
