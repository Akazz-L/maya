import { cn } from '../lib/utils';

export type View = 'write' | 'characters' | 'world' | 'styles' | 'timeline' | 'outlines';

const NAV_ITEMS: { view: View; icon: string; label: string }[] = [
  { view: 'write',      icon: '✏️', label: 'Write'      },
  { view: 'characters', icon: '👤', label: 'Characters' },
  { view: 'world',      icon: '🌍', label: 'World'      },
  { view: 'styles',     icon: '🎨', label: 'Styles'     },
  { view: 'timeline',   icon: '📅', label: 'Timeline'   },
  { view: 'outlines',   icon: '📋', label: 'Outlines'   },
];

interface NavBarProps {
  view: View;
  onViewChange: (v: View) => void;
}

export function NavBar({ view, onViewChange }: NavBarProps) {
  return (
    <nav className="flex w-11 flex-shrink-0 flex-col items-center gap-3 bg-[#1a1a2e] py-3">
      {NAV_ITEMS.map(({ view: v, icon, label }) => (
        <button
          key={v}
          title={label}
          type="button"
          onClick={() => onViewChange(v)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors',
            view === v
              ? 'bg-blue-500'
              : 'bg-[#2a2a4a] text-gray-400 hover:bg-[#3a3a5a]',
          )}
        >
          {icon}
        </button>
      ))}
    </nav>
  );
}
