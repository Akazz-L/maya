import { useState } from 'react';
import type { DocumentSummary } from '../api/types';
import { cn } from '../lib/utils';

const KIND_ICON: Record<string, string> = { bible: '⊙', chapter: '•', note: '▫' };

interface DocumentSidebarProps {
  documents: DocumentSummary[];
  activeId: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
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

  const commitRename = (id: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
  };

  const drop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const ids = documents.map((d) => d.id).filter((id) => id !== draggingId);
    ids.splice(ids.indexOf(targetId), 0, draggingId);
    onReorder(ids);
    setDraggingId(null);
  };

  // The bible is pinned above a divider and cannot be dragged or deleted.
  const bible = documents.filter((d) => d.kind === 'bible');
  const rest = documents.filter((d) => d.kind !== 'bible');

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
            className="min-w-0 flex-1 truncate text-left"
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
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {rest.map((d) => row(d, true))}
      </ul>

      <button
        type="button"
        onClick={onCreate}
        title="New document"
        aria-label="New document"
        className="mt-1 rounded-md border border-dashed border-gray-300 py-1.5 text-[13px] text-gray-400 hover:bg-gray-100"
      >
        {collapsed ? '+' : '+ New document'}
      </button>
    </nav>
  );
}
