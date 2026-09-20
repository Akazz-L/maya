import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type { DocumentDetail, DocumentKind, ProposalOutcome, UsageSnapshot } from '../api/types';
import { proposalExtension } from '../editor/proposalExtension';
import { rewriteExtension, type RewriteHost } from '../editor/rewriteExtension';
import type { SuggestionHost } from '../editor/suggestionWidget';
import { ChapterContext } from './ChapterContext';
import { ProposalLayer, type ProposalView } from './ProposalLayer';
import { ProseEditor } from './ProseEditor';
import { RewriteLayer } from './RewriteLayer';

export const AUTOSAVE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// Shown only while the body is empty, so they guide a blank document and then
// get out of the way. Each says what the AI does with that kind of document.
const BODY_PLACEHOLDER: Record<DocumentKind, string> = {
  bible:
    'Characters, world, voice, and timeline. The AI reads this before every draft and rewrite.',
  chapter: 'Write the chapter, or ask the chat for a draft…',
  note: 'Research, ideas, reminders. Notes are not included in the AI context.',
};

export interface EditorPatch {
  title?: string;
  body?: string;
}

interface DocumentEditorProps {
  document: DocumentDetail;
  projectId: string;
  readOnly: boolean;
  onSave: (patch: EditorPatch) => void;
  saveState: SaveState;
  /** Live text during a stream. Bypasses local state so the server stays authoritative. */
  bodyOverride?: string;
  /** True while a selection rewrite is streaming or under review. */
  onBusyChange?: (busy: boolean) => void;
  /** True once the month's AI budget is spent. */
  aiBlocked?: boolean;
  /** The writer's spend including a finished rewrite. */
  onUsage?: (usage: UsageSnapshot | undefined) => void;
  /** A chat proposal streaming in or awaiting review; the body is read-only meanwhile. */
  proposal?: ProposalView | null;
  /** `indexes` names the fixes of a suggestion set; absent for a whole-chapter proposal. */
  onProposalResolve?: (outcome: ProposalOutcome, indexes?: number[]) => void;
  /**
   * Filled with a function that saves any edit still waiting out the autosave
   * debounce, for callers about to ask the server to read the document.
   */
  flushRef?: { current: (() => void) | null };
  /**
   * Chapters only: the chapter context, owned by the workspace because the Plan
   * view edits the same text. Saving it is the owner's job, not this component's.
   */
  context?: string;
  onContextChange?: (value: string) => void;
}

const noop = () => {};

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="text-xs text-gray-400">Saving…</span>;
  if (state === 'saved') return <span className="text-xs text-green-600">Saved.</span>;
  if (state === 'error') return <span className="text-xs text-red-600">Error saving.</span>;
  return null;
}

/**
 * Local state is seeded from props once and never re-synced from them. The
 * parent remounts this component (via `key`) whenever the server authoritatively
 * rewrites the document — a different document, or a finished generation — which
 * avoids an effect that would otherwise fight the user's in-flight typing.
 */
export function DocumentEditor({
  document,
  projectId,
  readOnly,
  onSave,
  saveState,
  bodyOverride,
  onBusyChange,
  aiBlocked = false,
  onUsage,
  proposal = null,
  onProposalResolve,
  flushRef,
  context = '',
  onContextChange,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);

  const isChapter = document.kind === 'chapter';
  const [view, setView] = useState<EditorView | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  // A plain box rather than useRef: the rewrite extension keeps hold of it for
  // the view's whole life, and RewriteLayer fills in its callbacks each render.
  const [rewriteHost] = useState<{ current: RewriteHost }>(() => ({
    current: {
      onSelectionChange: () => {},
      onDocChanged: () => {},
      onRequestOpen: () => false,
      onEscape: () => false,
    },
  }));
  // The same arrangement for the suggestion cards: the widgets inside CodeMirror
  // hold this box for the view's whole life, and ProposalLayer fills in its
  // callbacks on each render.
  const [suggestionHost] = useState<{ current: SuggestionHost }>(() => ({
    current: { onAccept: () => {}, onDiscard: () => {} },
  }));
  const extensions = useMemo(
    () => (isChapter ? [rewriteExtension(rewriteHost), proposalExtension(suggestionHost)] : []),
    [isChapter, rewriteHost, suggestionHost],
  );
  const onBusyChangeRef = useRef(onBusyChange);
  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  });
  const handleBusy = useCallback((busy: boolean) => {
    setRewriteBusy(busy);
    onBusyChangeRef.current?.(busy);
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<EditorPatch | null>(null);
  const onSaveRef = useRef(onSave);
  // Kept current in an effect rather than during render: on unmount the ref
  // still holds the outgoing document's save function, which is what the flush
  // below needs.
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  const flush = () => {
    const patch = pending.current;
    pending.current = null;
    if (patch) onSaveRef.current(patch);
  };

  // Patches accumulate rather than replace: editing the title and then the body
  // inside one debounce window must not drop the title.
  const queueSave = (patch: EditorPatch) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  };

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => {
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
    return () => {
      flushRef.current = null;
    };
  });

  // Switching documents unmounts this component; flush rather than cancel, or
  // the last edits before the switch are silently lost. The closure still holds
  // the outgoing document's save function, so it saves to the right place.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, []);

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-2">
        <input
          value={title}
          aria-label="Document title"
          onChange={(e) => {
            setTitle(e.target.value);
            queueSave({ title: e.target.value });
          }}
          className="min-w-0 flex-1 border-none bg-transparent text-base font-semibold text-gray-800 outline-none"
        />
        <SaveIndicator state={saveState} />
      </div>

      {isChapter && (
        <ChapterContext value={context} onChange={(value) => onContextChange?.(value)} />
      )}

      <ProseEditor
        value={bodyOverride ?? body}
        readOnly={readOnly || rewriteBusy || proposal !== null}
        ariaLabel="Document body"
        placeholder={BODY_PLACEHOLDER[document.kind]}
        extensions={extensions}
        onViewReady={setView}
        onChange={(text) => {
          setBody(text);
          queueSave({ body: text });
        }}
      >
        {isChapter && view && (
          <RewriteLayer
            view={view}
            hostRef={rewriteHost}
            projectId={projectId}
            documentId={document.id}
            enabled={!readOnly && proposal === null}
            aiBlocked={aiBlocked}
            onBusyChange={handleBusy}
            onUsage={onUsage}
          />
        )}
        {isChapter && view && (
          <ProposalLayer
            view={view}
            proposal={proposal}
            hostRef={suggestionHost}
            onResolve={onProposalResolve ?? noop}
          />
        )}
      </ProseEditor>
    </main>
  );
}
