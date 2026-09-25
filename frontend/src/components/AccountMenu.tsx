import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useMe } from '../hooks/queries';
import { cn } from '../lib/utils';
import { Menu, MenuItem, MenuLabel } from './ui/menu';

/** The signed-in writer's initial, opening a menu with who they are and Log out. */
export function AccountMenu() {
  const { logout } = useAuth();
  const me = useMe();

  const email = me.data?.email ?? null;
  // Before the account loads there is no letter to show, so stand in with a dot.
  const initial = email?.[0]?.toUpperCase() ?? '·';

  return (
    <Menu
      label="Account"
      align="end"
      trigger={(props, open) => (
        <button
          type="button"
          aria-label="Account"
          className={cn(
            'flex size-8 items-center justify-center rounded-full border font-serif text-sm font-semibold',
            'transition-[background-color,border-color,color] duration-150',
            open
              ? 'border-line-strong bg-surface-sunken text-ink'
              : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
          )}
          {...props}
        >
          {initial}
        </button>
      )}
    >
      {email && <MenuLabel>{email}</MenuLabel>}
      <MenuItem icon={<LogOut aria-hidden />} onSelect={logout}>
        Log out
      </MenuItem>
    </Menu>
  );
}
