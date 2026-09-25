import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AccountMenu } from './AccountMenu';
import { Wordmark } from './Wordmark';

interface AppHeaderProps {
  /** Shown before the wordmark: the document-list toggle on a narrow screen. */
  leading?: ReactNode;
  /** Where the writer is, after the wordmark: the open project's name. */
  title?: ReactNode;
  /** Account-level controls beside the account menu. */
  children?: ReactNode;
}

/** The bar across the top of every signed-in screen. */
export function AppHeader({ leading, title, children }: AppHeaderProps) {
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
        <AccountMenu />
      </div>
    </header>
  );
}
