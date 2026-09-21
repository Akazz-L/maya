import { useState, type ReactNode } from 'react';
import {
  BookMarked,
  ChevronDown,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import type { DocumentKind, DocumentSummary } from '../api/types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { Menu, MenuItem } from './ui/menu';

// Creatable kinds, in menu order. The bible is seeded with the project, never here.
const NEW_KINDS: { kind: DocumentKind; label: string; hint: string; icon: ReactNode }[] = [
  {
    kind: 'chapter',
    label: 'New chapter',
    hint: 'Story text, read in order by the AI.',
    icon: <FileText />,
  },
  {
    kind: 'note',
    label: 'New note',
    hint: 'Research and reminders. The AI never reads notes.',
    icon: <StickyNote />,
  },
];

interface DocumentSidebarProps {
  documents: DocumentSummary[];
  activeId: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Set when the list is a drawer over the page, on a narrow screen: it closes rather than collapses. */
  onClose?: () => void;
  onSelect: (id: string) => void;
  onCreate: (kind: DocumentKind) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

const iconButton =
  'flex size-6 shrink-0 items-center justify-center rounded-[5px] text-ink-subtle hover:bg-surface-sunken hover:text-ink [&_svg]:size-3.5';

export function DocumentSidebar({
  documents,
  activeId,
  collapsed: collapsedPref,
  onToggleCollapsed,
  onClose,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: DocumentSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<DocumentSummary | null>(null);
  // A drawer is opened to be read; it never shows the collapsed rail.
  const collapsed = collapsedPref && !onClose;

  const commitRename = (id: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
  };

  const endDrag = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  const drop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return endDrag();
    const dragged = documents.find((d) => d.id === draggingId);
    const target = documents.find((d) => d.id === targetId);
    // A drag across sections would silently move a document out of the group
    // its kind puts it in, so confine reordering to one section.
    if (!dragged || !target || dragged.kind !== target.kind) return endDrag();
    const ids = documents.map((d) => d.id).filter((id) => id !== draggingId);
    ids.splice(ids.indexOf(targetId), 0, draggingId);
    onReorder(ids);
    endDrag();
  };

  // Three sections, because a chapter and a note are read very differently by
  // the agents: chapter order is story order, and notes are context-invisible.
  // The bible is pinned to the top and cannot be dragged or deleted.
  const bible = documents.filter((d) => d.kind === 'bible');
  const chapters = documents.filter((d) => d.kind === 'chapter');
  const notes = documents.filter((d) => d.kind === 'note');

  const sectionHeading = (label: string, count: number) =>
    collapsed ? null : (
      <div className="flex items-baseline justify-between px-2 pt-4 pb-1">
        <span className="text-xs font-medium text-ink-subtle">{label}</span>
        <span className="text-xs text-ink-faint tabular-nums">{count}</span>
      </div>
    );

  // Chapters are a sequence, so they carry their place in it; the others an icon.
  const marker = (doc: DocumentSummary, ordinal?: number) =>
    doc.kind === 'chapter' ? (
      // Hidden from assistive tech: the list already announces "1 of 3".
      <span aria-hidden className="w-4 shrink-0 text-center text-xs text-ink-subtle tabular-nums">
        {ordinal}
      </span>
    ) : doc.kind === 'bible' ? (
      <BookMarked aria-hidden className="size-4 shrink-0 text-ink-subtle" />
    ) : (
      <StickyNote aria-hidden className="size-4 shrink-0 text-ink-subtle" />
    );

  const row = (doc: DocumentSummary, draggable: boolean, ordinal?: number) => {
    const active = doc.id === activeId;
    return (
      <li
        key={doc.id}
        draggable={draggable && renamingId !== doc.id}
        onDragStart={() => setDraggingId(doc.id)}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          e.preventDefault();
          if (draggingId && dropTargetId !== doc.id) setDropTargetId(doc.id);
        }}
        onDrop={() => drop(doc.id)}
        className={cn(
          'group relative flex h-8 items-center gap-2 rounded-control px-2 text-sm transition-colors',
          active
            ? 'bg-surface text-ink shadow-xs ring-1 ring-line'
            : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
          draggingId === doc.id && 'opacity-40',
          // Where the dragged row will land: above this one.
          dropTargetId === doc.id &&
            draggingId !== doc.id &&
            'before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-pencil',
          collapsed && 'justify-center px-0',
        )}
      >
        {renamingId === doc.id ? (
          <>
            {marker(doc, ordinal)}
            <input
              autoFocus
              aria-label={`Rename ${doc.title}`}
              defaultValue={doc.title}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(doc.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(doc.id, e.currentTarget.value);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              className="-mx-1 h-6 min-w-0 flex-1 rounded-[4px] border border-pencil bg-surface px-1 text-sm text-ink outline-none"
            />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onSelect(doc.id)}
              onDoubleClick={() => setRenamingId(doc.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={collapsed ? doc.title : undefined}
              title={collapsed ? doc.title : undefined}
              className={cn(
                'flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none',
                'after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-pencil',
                collapsed && 'justify-center',
              )}
            >
              {marker(doc, ordinal)}
              {!collapsed && (
                <span
                  className={cn(
                    'truncate',
                    active && 'font-medium',
                    // Notes are not story text and never reach an agent, so they
                    // read as marginalia rather than as another chapter.
                    doc.kind === 'note' && 'font-serif italic',
                  )}
                >
                  {doc.title}
                </span>
              )}
            </button>
            {!collapsed && (
              // Revealed on hover, and on keyboard focus so they stay reachable.
              <span className="relative flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                <button
                  type="button"
                  title={`Rename ${doc.title}`}
                  aria-label={`Rename ${doc.title}`}
                  onClick={() => setRenamingId(doc.id)}
                  className={iconButton}
                >
                  <Pencil aria-hidden />
                </button>
                {doc.kind !== 'bible' && (
                  <button
                    type="button"
                    title={`Delete ${doc.title}`}
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => setConfirmingDelete(doc)}
                    className={cn(iconButton, 'hover:bg-danger-soft hover:text-danger')}
                  >
                    <Trash2 aria-hidden />
                  </button>
                )}
              </span>
            )}
          </>
        )}
      </li>
    );
  };

  return (
    <nav
      aria-label="Documents"
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-line bg-surface-muted transition-[width] duration-200',
        onClose ? 'w-72 max-w-[85vw]' : collapsed ? 'w-14' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex h-11 shrink-0 items-center px-3',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        {!collapsed && <span className="text-xs font-medium text-ink-subtle">Documents</span>}
        {onClose ? (
          <Button variant="ghost" size="icon-sm" aria-label="Close documents" onClick={onClose}>
            <X aria-hidden />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-0.5">{bible.map((d) => row(d, false))}</ul>

        {sectionHeading('Chapters', chapters.length)}
        {collapsed && <div aria-hidden className="mx-2 my-2 border-t border-line" />}
        <ul className="flex flex-col gap-0.5">{chapters.map((d, i) => row(d, true, i + 1))}</ul>
        {chapters.length === 0 && !collapsed && (
          <p className="px-2 py-1 text-xs text-ink-faint">No chapters yet.</p>
        )}

        {notes.length > 0 && (
          <>
            {sectionHeading('Notes', notes.length)}
            {collapsed && <div aria-hidden className="mx-2 my-2 border-t border-line" />}
            <ul className="flex flex-col gap-0.5">{notes.map((d) => row(d, true))}</ul>
          </>
        )}
      </div>

      {/* Split button: the common case (a chapter) stays one click, while the
          caret reaches the other kinds. Without it, notes are uncreatable. */}
      <div className={cn('shrink-0 border-t border-line p-2', collapsed && 'px-1.5')}>
        <div className="flex rounded-control border border-line bg-surface text-sm text-ink shadow-xs">
          <button
            type="button"
            onClick={() => onCreate('chapter')}
            title="New chapter"
            aria-label="New chapter"
            className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-control font-medium hover:bg-surface-muted"
          >
            <Plus aria-hidden className="size-4 text-ink-subtle" />
            {!collapsed && 'New chapter'}
          </button>
          {!collapsed && (
            <Menu
              label="New document"
              side="top"
              align="end"
              className="w-64"
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  title="Choose document type"
                  aria-label="Choose document type"
                  className="flex h-8 items-center rounded-r-control border-l border-line px-2 text-ink-subtle hover:bg-surface-muted hover:text-ink"
                >
                  <ChevronDown aria-hidden className="size-4" />
                </button>
              )}
            >
              {NEW_KINDS.map(({ kind, label, hint, icon }) => (
                <MenuItem key={kind} icon={icon} hint={hint} onSelect={() => onCreate(kind)}>
                  {label}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete “${confirmingDelete.title}”?`}
          description="The document and everything in it will be gone. This can't be undone."
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmingDelete(null)}
          onConfirm={() => {
            onDelete(confirmingDelete.id);
            setConfirmingDelete(null);
          }}
        />
      )}
    </nav>
  );
}
