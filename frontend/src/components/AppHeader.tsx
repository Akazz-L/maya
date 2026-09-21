import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Wordmark } from './Wordmark';
import { Button } from './ui/button';

interface AppHeaderProps {
  /** Shown before the wordmark: the document-list toggle on a narrow screen. */
  leading?: ReactNode;
  /** Where the writer is, after the wordmark: the open project's name. */
  title?: ReactNode;
  /** Account-level controls beside Log out. */
  children?: ReactNode;
}

/** The bar across the top of every signed-in screen. */
export function AppHeader({ leading, title, children }: AppHeaderProps) {
  const { logout } = useAuth();
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      {leading}
      <Link
        to="/"
        className="rounded-control px-1.5 py-1 text-lg leading-none hover:bg-surface-sunken"
        aria-label="Maya — all projects"
      >
        <Wordmark />
      </Link>
      {title && (
        <>
          <span aria-hidden className="text-ink-faint">
            /
          </span>
          <h1 className="min-w-0 truncate text-sm font-medium text-ink">{title}</h1>
        </>
      )}
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {children}
        <Button variant="ghost" size="sm" onClick={logout} aria-label="Log out" title="Log out">
          <LogOut aria-hidden />
          <span className="hidden sm:inline">Log out</span>
        </Button>
      </div>
    </header>
  );
}
