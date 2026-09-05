import { useEffect, useRef, useState } from 'react';
import type { DocumentKind, DocumentSummary } from '../api/types';
import { cn } from '../lib/utils';

const KIND_ICON: Record<string, string> = { bible: '⊙', chapter: '•', note: '▫' };
// Creatable kinds, in menu order. The bible is seeded with the project, never here.
const NEW_KINDS: { kind: DocumentKind; label: string }[] = [
  { kind: 'chapter', label: 'chapter' },
  { kind: 'note', label: 'note' },
];

interface DocumentSidebarProps {
  documents: DocumentSummary[];
  activeId: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onCreate: (kind: DocumentKind) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

export function DocumentSidebar({
  documents,
  activeId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: DocumentSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss the kind menu on an outside press or Escape. Listeners are bound
  // only while it is open, so a closed menu costs nothing.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const create = (kind: DocumentKind) => {
    setMenuOpen(false);
    onCreate(kind);
  };

  const commitRename = (id: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
  };

  const drop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const dragged = documents.find((d) => d.id === draggingId);
    const target = documents.find((d) => d.id === targetId);
    // A drag across sections would silently move a document out of the group
    // its kind puts it in, so confine reordering to one section.
    if (!dragged || !target || dragged.kind !== target.kind) {
      setDraggingId(null);
      return;
    }
    const ids = documents.map((d) => d.id).filter((id) => id !== draggingId);
    ids.splice(ids.indexOf(targetId), 0, draggingId);
    onReorder(ids);
    setDraggingId(null);
  };

  // Three sections, because a chapter and a note are read very differently by
  // the agents: chapter order is story order, and notes are context-invisible.
  // The bible is pinned to the top and cannot be dragged or deleted.
  const bible = documents.filter((d) => d.kind === 'bible');
  const chapters = documents.filter((d) => d.kind === 'chapter');
  const notes = documents.filter((d) => d.kind === 'note');

  const sectionHeading = (label: string, count: number) =>
    collapsed ? null : (
      <div className="flex items-baseline justify-between px-2 pt-2 pb-1">
        <span className="text-[10px] font-semibold tracking-wider text-gray-400 uppercase">
          {label}
        </span>
        <span className="text-[10px] text-gray-300 tabular-nums">{count}</span>
      </div>
    );

  const row = (doc: DocumentSummary, draggable: boolean) => (
    <li
      key={doc.id}
      draggable={draggable}
      onDragStart={() => setDraggingId(doc.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => drop(doc.id)}
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        doc.id === activeId ? 'bg-blue-50 text-blue-900' : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      <span className="w-3 flex-shrink-0 text-center text-xs text-gray-400">
        {KIND_ICON[doc.kind]}
      </span>
      {collapsed ? null : renamingId === doc.id ? (
        <input
          autoFocus
          defaultValue={doc.title}
          onBlur={(e) => commitRename(doc.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(doc.id, e.currentTarget.value);
            if (e.key === 'Escape') setRenamingId(null);
          }}
          className="min-w-0 flex-1 rounded border border-blue-300 px-1 py-0.5 text-sm"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSelect(doc.id)}
            onDoubleClick={() => setRenamingId(doc.id)}
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              // Notes are not story text and never reach an agent, so they read
              // as marginalia rather than as another chapter.
              doc.kind === 'note' && 'italic',
            )}
          >
            {doc.title}
          </button>
          {doc.kind !== 'bible' && (
            <button
              type="button"
              title={`Delete ${doc.title}`}
              onClick={() => {
                if (window.confirm(`Delete "${doc.title}"? This cannot be undone.`))
                  onDelete(doc.id);
              }}
              className="flex-shrink-0 px-1 text-xs text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </>
      )}
    </li>
  );

  return (
    <nav
      className={cn(
        'flex flex-shrink-0 flex-col gap-1 border-r border-gray-200 bg-[#fafaf7] py-2',
        collapsed ? 'w-11 px-1' : 'w-60 px-2',
      )}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        {!collapsed && (
          <span className="text-xs font-medium tracking-wide text-gray-400 uppercase">
            Documents
          </span>
        )}
        <button
          type="button"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
          className="rounded px-1 text-xs text-gray-400 hover:bg-gray-200"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <ul className="flex flex-col gap-0.5">{bible.map((d) => row(d, false))}</ul>
      {!collapsed && <div className="my-1 border-t border-gray-200" />}

      <div className="flex-1 overflow-y-auto">
        {sectionHeading('Chapters', chapters.length)}
        <ul className="flex flex-col gap-0.5">{chapters.map((d) => row(d, true))}</ul>
        {chapters.length === 0 && !collapsed && (
          <p className="px-2 py-1 text-xs text-gray-300">No chapters yet.</p>
        )}

        {notes.length > 0 && (
          <>
            {!collapsed && <div className="mt-2 border-t border-gray-200" />}
            {sectionHeading('Notes', notes.length)}
            <ul className="flex flex-col gap-0.5">{notes.map((d) => row(d, true))}</ul>
          </>
        )}
      </div>

      {/* Split button: the common case (a chapter) stays one click, while the
          caret reaches the other kinds. Without it, notes are uncreatable. */}
      <div ref={menuRef} className="relative mt-1">
        {menuOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-0 z-10 mb-1 min-w-36 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          >
            {NEW_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                onClick={() => create(kind)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-100"
              >
                <span className="w-3 text-center text-xs text-gray-400">{KIND_ICON[kind]}</span>
                New {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex rounded-md border border-dashed border-gray-300 text-[13px] text-gray-400">
          <button
            type="button"
            onClick={() => create('chapter')}
            title="New chapter"
            aria-label="New chapter"
            className="min-w-0 flex-1 rounded-l-md py-1.5 hover:bg-gray-100"
          >
            {collapsed ? '+' : '+ New chapter'}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="Choose document type"
            aria-label="Choose document type"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex-shrink-0 rounded-r-md border-l border-dashed border-gray-300 px-1.5 hover:bg-gray-100"
          >
            ▾
          </button>
        </div>
      </div>
    </nav>
  );
}
