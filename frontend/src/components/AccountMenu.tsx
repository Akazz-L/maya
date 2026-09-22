import { useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useDismiss } from '../hooks/useDismiss';
import { useMe } from '../hooks/queries';
import { cn } from '../lib/utils';

/** The signed-in writer's initial, opening a menu with who they are and Log out. */
export function AccountMenu() {
  const { logout } = useAuth();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  const email = typeof me.data?.email === 'string' ? me.data.email : null;
  const initial = email?.[0]?.toUpperCase() ?? '·';

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex size-8 items-center justify-center rounded-full border font-serif text-sm font-semibold transition-colors',
          open
            ? 'border-accent bg-accent-soft text-accent-ink'
            : 'border-line bg-raised text-ink-2 hover:border-ink-3/60 hover:text-ink',
        )}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute top-full right-0 z-40 mt-2 w-60 origin-top-right animate-rise overflow-hidden rounded-xl border border-line bg-raised shadow-pop"
        >
          {email && (
            <p className="truncate border-b border-line-soft px-3.5 py-2.5 text-[13px] text-ink-2">
              {email}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-ink hover:bg-surface"
          >
            <LogOut aria-hidden className="size-4 text-ink-3" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
