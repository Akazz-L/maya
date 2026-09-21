import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { cn } from '../../lib/utils';

interface TriggerProps {
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

interface MenuProps {
  /** Accessible name of the list. */
  label: string;
  /** Renders the button that opens the menu, given the props that wire it up. */
  trigger: (props: TriggerProps, open: boolean) => ReactNode;
  /** Which way it opens from the trigger. */
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  className?: string;
  children: ReactNode;
}

/** How an item closes the menu it sits in once it has acted. */
const CloseMenu = createContext<() => void>(() => {});

const ITEM = '[role="menuitem"]:not([disabled])';

/**
 * A button that opens a list of actions, with the keyboard behaviour of a
 * menu: arrows move between items, Escape closes and returns focus.
 */
export function Menu({
  label,
  trigger,
  side = 'bottom',
  align = 'start',
  className,
  children,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  // Which item takes focus when the menu opens: arrow-up from the trigger starts at the end.
  const [start, setStart] = useState<'first' | 'last'>('first');
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback(() => setOpen(false), []);
  const closeAndReturn = useCallback(() => {
    setOpen(false);
    root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  }, []);
  // Escape hands focus back to the trigger; a press elsewhere leaves it where it landed.
  const dismiss = useCallback(
    (reason: 'outside' | 'escape') => (reason === 'escape' ? closeAndReturn() : close()),
    [close, closeAndReturn],
  );
  useDismiss(open, root, dismiss);

  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);

  useLayoutEffect(() => {
    if (!open) return;
    const all = items();
    (start === 'first' ? all[0] : all[all.length - 1])?.focus();
  }, [open, start]);

  const onTriggerKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setStart(e.key === 'ArrowDown' ? 'first' : 'last');
      setOpen(true);
    }
  };

  const onListKeyDown = (e: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(all.length - 1);
    else if (e.key === 'Tab') close();
  };

  return (
    <div ref={root} className="relative">
      {trigger(
        {
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? id : undefined,
          onClick: () => {
            setStart('first');
            setOpen((o) => !o);
          },
          onKeyDown: onTriggerKeyDown,
        },
        open,
      )}
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onListKeyDown}
          className={cn(
            'absolute z-popover min-w-44 overflow-hidden rounded-panel border border-line bg-surface p-1 shadow-float animate-pop',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            align === 'start' ? 'left-0' : 'right-0',
            className,
          )}
        >
          <CloseMenu value={closeAndReturn}>{children}</CloseMenu>
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  /** A second line saying what the action does. */
  hint?: ReactNode;
  children: ReactNode;
}

/** An action in a Menu. Choosing it closes the menu, then runs `onSelect`. */
export function MenuItem({ onSelect, icon, hint, children }: MenuItemProps) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        'flex w-full gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left text-sm text-ink outline-none',
        'hover:bg-surface-sunken focus-visible:bg-surface-sunken focus:bg-surface-sunken',
        hint ? 'items-start' : 'items-center',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle',
      )}
    >
      {icon && <span className={cn('flex', hint && 'mt-0.5')}>{icon}</span>}
      <span className="min-w-0">
        <span className="block font-medium">{children}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-ink-subtle">{hint}</span>}
      </span>
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-ink-subtle">{children}</p>;
}
