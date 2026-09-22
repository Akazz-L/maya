import { useRef, useState, type ReactNode } from 'react';
import {
  BookMarked,
  ChevronDown,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type { DocumentKind, DocumentSummary } from '../api/types';
import { useDismiss } from '../hooks/useDismiss';
import { cn } from '../lib/utils';
import { ConfirmDialog } from './ui/confirm-dialog';

// Creatable kinds, in menu order. The bible is seeded with the project, never here.
const NEW_KINDS: { kind: DocumentKind; label: string; hint: string; icon: ReactNode }[] = [
  {
    kind: 'chapter',
    label: 'New chapter',
    hint: 'Story text, read by the AI in order',
    icon: <FileText aria-hidden />,
  },
  {
    kind: 'note',
    label: 'New note',
    hint: 'Research and reminders, never sent to the AI',
    icon: <StickyNote aria-hidden />,
  },
];

interface DocumentSidebarProps {
  documents: DocumentSummary[];
  /** The list has not arrived yet: show placeholder rows, not an empty project. */
  loading?: boolean;
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
  loading = false,
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
  const [overId, setOverId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DocumentSummary | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false));

  const create = (kind: DocumentKind) => {
    setMenuOpen(false);
    onCreate(kind);
  };

  const commitRename = (id: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
  };

  // A drag across sections would silently move a document out of the group
  // its kind puts it in, so reordering is confined to one section.
  const canDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return false;
    const dragged = documents.find((d) => d.id === draggingId);
    const target = documents.find((d) => d.id === targetId);
    return !!dragged && !!target && dragged.kind === target.kind;
  };

  const endDrag = () => {
    setDraggingId(null);
    setOverId(null);
  };

  const drop = (targetId: string) => {
    if (canDrop(targetId)) {
      const ids = documents.map((d) => d.id).filter((id) => id !== draggingId);
      ids.splice(ids.indexOf(targetId), 0, draggingId!);
      onReorder(ids);
    }
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
      <div className="flex items-baseline justify-between px-2.5 pt-4 pb-1.5">
        <span className="text-xs font-semibold text-ink-2">{label}</span>
        <span className="text-xs text-ink-3 tabular-nums">{count}</span>
      </div>
    );

  /**
   * The marker before a title: its kind. Collapsed to a rail, a chapter shows
   * its place in the story instead, since a column of identical page icons
   * could not tell one chapter from the next.
   */
  const marker = (doc: DocumentSummary, index: number) => (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 items-center justify-center text-ink-3 [&_svg]:size-3.5',
        doc.id === activeId && 'text-accent',
      )}
    >
      {doc.kind === 'bible' ? (
        <BookMarked />
      ) : doc.kind === 'note' ? (
        <StickyNote />
      ) : collapsed ? (
        <span className="font-serif text-[13px] font-medium tabular-nums">{index + 1}</span>
      ) : (
        <FileText />
      )}
    </span>
  );

  const row = (doc: DocumentSummary, index: number, draggable: boolean) => {
    const active = doc.id === activeId;
    return (
      <li
        key={doc.id}
        draggable={draggable && renamingId !== doc.id}
        onDragStart={() => setDraggingId(doc.id)}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          e.preventDefault();
          if (overId !== doc.id) setOverId(doc.id);
        }}
        onDragLeave={() => setOverId((o) => (o === doc.id ? null : o))}
        onDrop={() => drop(doc.id)}
        title={collapsed ? doc.title : undefined}
        className={cn(
          'group relative flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors',
          active
            ? 'bg-paper font-medium text-ink shadow-[0_1px_2px_rgb(29_36_51/0.08)]'
            : 'text-ink-2 hover:bg-ink/5 hover:text-ink',
          draggable && 'active:cursor-grabbing',
          draggingId === doc.id && 'opacity-40',
          // Where the dragged document will land: above this row.
          overId === doc.id &&
            canDrop(doc.id) &&
            'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded-full before:bg-accent',
        )}
      >
        {collapsed ? (
          <button
            type="button"
            aria-label={doc.title}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(doc.id)}
            className="flex w-full justify-center"
          >
            {marker(doc, index)}
          </button>
        ) : renamingId === doc.id ? (
          <>
            {marker(doc, index)}
            <input
              autoFocus
              defaultValue={doc.title}
              aria-label="Document name"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(doc.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(doc.id, e.currentTarget.value);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-accent bg-paper px-1.5 text-sm text-ink outline-none"
            />
          </>
        ) : (
          <>
            {marker(doc, index)}
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(doc.id)}
              onDoubleClick={() => setRenamingId(doc.id)}
              title="Double-click to rename"
              className={cn(
                'min-w-0 flex-1 truncate rounded-sm text-left',
                // Notes are not story text and never reach an agent, so they read
                // as marginalia rather than as another chapter.
                doc.kind === 'note' && 'font-serif italic',
              )}
            >
              {doc.title}
            </button>
            {doc.kind !== 'bible' && (
              <button
                type="button"
                title={`Delete ${doc.title}`}
                aria-label={`Delete ${doc.title}`}
                onClick={() => setConfirmDelete(doc)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </button>
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
        'flex shrink-0 flex-col border-r border-line-soft bg-surface py-3 transition-[width] duration-200',
        collapsed
          ? 'w-14 px-2'
          : 'w-64 px-3 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-pop',
      )}
    >
      {loading && (
        <ul aria-busy="true" aria-label="Loading documents" className="flex flex-col gap-2 px-2 pt-2">
          {[70, 55, 62, 48].map((width) => (
            <li
              key={width}
              className="h-5 animate-pulse rounded-md bg-ink/6"
              style={{ width: `${width}%` }}
            />
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-0.5">{bible.map((d, i) => row(d, i, false))}</ul>

      <div className="-mx-1 mt-1 flex-1 overflow-y-auto px-1">
        {!loading && sectionHeading('Chapters', chapters.length)}
        {collapsed && <div className="mx-2 my-2 h-px bg-line" />}
        <ul className="flex flex-col gap-0.5">{chapters.map((d, i) => row(d, i, true))}</ul>
        {chapters.length === 0 && !collapsed && !loading && (
          <p className="px-2.5 py-1 text-[13px] text-ink-3">No chapters yet.</p>
        )}

        {notes.length > 0 && (
          <>
            {sectionHeading('Notes', notes.length)}
            {collapsed && <div className="mx-2 my-2 h-px bg-line" />}
            <ul className="flex flex-col gap-0.5">{notes.map((d, i) => row(d, i, true))}</ul>
          </>
        )}
      </div>

      <div className={cn('mt-3 flex gap-1.5', collapsed && 'flex-col-reverse items-center')}>
        <button
          type="button"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="size-4" />
          ) : (
            <PanelLeftClose aria-hidden className="size-4" />
          )}
        </button>

        {/* Split button: the common case (a chapter) stays one click, while the
            caret reaches the other kinds. */}
        <div ref={menuRef} className="relative min-w-0 flex-1">
          {menuOpen && (
            <div
              role="menu"
              className={cn(
                'absolute bottom-full z-30 mb-2 w-64 origin-bottom-left animate-rise overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-pop',
                collapsed ? 'left-0' : 'right-0',
              )}
            >
              {NEW_KINDS.map(({ kind, label, hint, icon }) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => create(kind)}
                  className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:text-ink-3"
                >
                  {icon}
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-ink">{label}</span>
                    <span className="text-xs text-ink-3">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div
            className={cn(
              'flex h-9 overflow-hidden rounded-lg border border-line bg-raised text-[13px] font-medium text-ink shadow-xs',
              collapsed && 'flex-col h-auto',
            )}
          >
            <button
              type="button"
              onClick={() => create('chapter')}
              title="New chapter"
              aria-label="New chapter"
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-2 hover:bg-surface"
            >
              <Plus aria-hidden className="size-4 text-accent" />
              {!collapsed && 'New chapter'}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              title="Choose document type"
              aria-label="Choose document type"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={cn(
                'flex shrink-0 items-center justify-center px-2 text-ink-3 hover:bg-surface hover:text-ink',
                collapsed ? 'border-t border-line py-1' : 'border-l border-line',
              )}
            >
              <ChevronDown aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete “${confirmDelete?.title ?? ''}”?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) onDelete(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </nav>
  );
}
