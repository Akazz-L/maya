import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import { AlertCircle, Check } from 'lucide-react';
import type { DocumentDetail, DocumentKind, ProposalOutcome, UsageSnapshot } from '../api/types';
import { proposalExtension } from '../editor/proposalExtension';
import { rewriteExtension, type RewriteHost } from '../editor/rewriteExtension';
import type { SuggestionHost } from '../editor/suggestionWidget';
import { cn } from '../lib/utils';
import { ChapterContext } from './ChapterContext';
import { AUTOSAVE_MS, type SaveState } from '../hooks/useDocumentSaving';
import type { ProposalView } from '../lib/proposalView';
import { ProposalLayer } from './ProposalLayer';
import { ProseEditor } from './ProseEditor';
import { RewriteLayer } from './RewriteLayer';
import { Spinner } from './ui/feedback';

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
  onSave: (patch: EditorPatch) => void;
  saveState: SaveState;
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
  /**
   * Chapters only: the line naming what the AI reads of the story so far. Passed
   * in rather than built here, because it is fetched per chapter.
   */
  contextNote?: ReactNode;
}

const noop = () => {};

const SAVE_STATUS: Record<
  Exclude<SaveState, 'idle'>,
  { icon: ReactNode; text: string; tone: string }
> = {
  saving: { icon: <Spinner className="size-3" />, text: 'Saving…', tone: 'text-ink-subtle' },
  saved: { icon: <Check aria-hidden className="size-3" />, text: 'Saved', tone: 'text-ink-subtle' },
  error: {
    icon: <AlertCircle aria-hidden className="size-3" />,
    text: "Couldn't save. Your next edit retries.",
    tone: 'text-danger',
  },
};

/** Always mounted, so a screen reader hears each change of state. */
function SaveIndicator({ state }: { state: SaveState }) {
  const status = state === 'idle' ? null : SAVE_STATUS[state];
  return (
    <span
      role="status"
      className={cn('flex h-6 shrink-0 items-center gap-1 text-xs', status?.tone)}
    >
      {status?.icon}
      {status?.text}
    </span>
  );
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
  onSave,
  saveState,
  onBusyChange,
  aiBlocked = false,
  onUsage,
  proposal = null,
  onProposalResolve,
  flushRef,
  context = '',
  onContextChange,
  contextNote,
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
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {/* The title sits on the same column as the prose beneath it: one page. */}
      <div className="mx-auto flex w-full max-w-page items-center gap-4 px-6 pt-6 pb-2 sm:pt-8">
        <input
          value={title}
          aria-label="Document title"
          placeholder="Untitled"
          onChange={(e) => {
            setTitle(e.target.value);
            queueSave({ title: e.target.value });
          }}
          className="min-w-0 flex-1 border-none bg-transparent font-serif text-2xl font-semibold tracking-[-0.01em] text-ink outline-none placeholder:text-ink-faint sm:text-[28px]"
        />
        <SaveIndicator state={saveState} />
      </div>

      {isChapter && (
        <>
          <ChapterContext value={context} onChange={(value) => onContextChange?.(value)} />
          {contextNote}
        </>
      )}

      <ProseEditor
        value={body}
        readOnly={rewriteBusy || proposal !== null}
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
            enabled={proposal === null}
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
    </div>
  );
}
