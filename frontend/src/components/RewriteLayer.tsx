// Owns one chapter's rewrite flow: the selection pill, the prompt card, the
// stream, the in-document overlay, and the review bar. It never writes to
// the document except through the single Accept transaction.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { acceptTx, setRewriteOverlay, type RewriteHost } from '../editor/rewriteExtension';
import { useSelectionRewrite } from '../hooks/useSelectionRewrite';
import { contextWindows, type TextRange } from '../lib/rewrite';
import { RewritePrompt } from './RewritePrompt';
import { RewriteReviewBar } from './RewriteReviewBar';

export interface RewriteLayerProps {
  view: EditorView;
  /** The same object handed to rewriteExtension; this layer fills in its callbacks. */
  hostRef: { current: RewriteHost };
  projectId: string;
  documentId: string;
  /** False while a generation stream owns the editor. */
  enabled: boolean;
  /** True while a rewrite is streaming or under review. */
  onBusyChange: (busy: boolean) => void;
}

interface Anchor {
  top: number;
  bottom: number;
  left: number;
}

const FALLBACK: Anchor = { top: 16, bottom: 40, left: 24 };
const PILL_HEIGHT = 30;
const GAP = 6;

/**
 * Where a document range sits, relative to the editor box. Null before layout.
 *
 * While the overlay replaces the span with a widget, `coordsAtPos` answers with
 * the widget's first client rect, so a span that wraps would put the card on top
 * of its own second line. Measure the rendered widget instead: first rect for the
 * top edge, last rect for the bottom, so the card clears the whole span.
 */
function anchorFor(view: EditorView, range: TextRange, widget: boolean): Anchor | null {
  const box = view.dom.getBoundingClientRect();
  const relative = (top: number, bottom: number, left: number): Anchor => ({
    top: top - box.top,
    bottom: bottom - box.top,
    left: Math.max(16, Math.min(left - box.left, box.width - 440)),
  });

  if (widget) {
    const rects = view.contentDOM.querySelector('.cm-rewrite-widget')?.getClientRects();
    if (rects?.length) {
      const first = rects[0];
      return relative(first.top, rects[rects.length - 1].bottom, first.left);
    }
  }

  const start = view.coordsAtPos(range.from);
  const end = view.coordsAtPos(range.to, -1);
  if (!start || !end) return null;
  return relative(start.top, end.bottom, start.left);
}

export function RewriteLayer({
  view,
  hostRef,
  projectId,
  documentId,
  enabled,
  onBusyChange,
}: RewriteLayerProps) {
  const rewrite = useSelectionRewrite({ projectId, documentId });
  const { phase, range, original, instruction, replacement, error } = rewrite.state;
  const [selection, setSelection] = useState<TextRange | null>(null);
  const [showDiff, setShowDiff] = useState(true);
  const card = useRef<HTMLDivElement>(null);

  const busy = phase === 'streaming' || phase === 'reviewing';

  const open = () => {
    if (!enabled || !selection) return false;
    setShowDiff(true);
    rewrite.open(selection, view.state.sliceDoc(selection.from, selection.to));
    return true;
  };

  const discard = () => {
    rewrite.cancel();
    view.focus();
  };

  const accept = () => {
    if (phase !== 'reviewing' || error || !range) return;
    // The overlay field already drops itself on any document change; the
    // React state machine must not outlive it, or Accept would splice over
    // whatever now occupies these offsets.
    if (view.state.sliceDoc(range.from, range.to) !== original) {
      discard();
      return;
    }
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: replacement },
      selection: { anchor: range.from + replacement.length },
      effects: setRewriteOverlay.of(null),
      annotations: acceptTx.of(true),
      userEvent: 'input.rewrite',
    });
    rewrite.cancel();
    view.focus();
  };

  const submit = (text: string) => {
    if (!range) return;
    void rewrite.submit(text, contextWindows(view.state.doc.toString(), range));
  };

  // The extension and the window listener fire outside React's render, so
  // they go through a ref that always holds this render's handlers.
  const latest = useRef({ open, discard, accept, phase });
  useEffect(() => {
    latest.current = { open, discard, accept, phase };
    hostRef.current = {
      onSelectionChange: (r) => {
        setSelection(r);
        // Clicking or typing elsewhere while the prompt is open dismisses it.
        if (latest.current.phase === 'prompting') latest.current.discard();
      },
      // Anything that edits the document — typing, undo, a finished generation —
      // invalidates the range the overlay was drawn against, and the field has
      // already dropped it. Accept's own transaction never reaches here.
      onDocChanged: () => {
        const { phase: current, discard: drop } = latest.current;
        if (current === 'streaming' || current === 'reviewing') drop();
      },
      onRequestOpen: () => latest.current.open(),
      onEscape: () => {
        if (latest.current.phase === 'idle') return false;
        latest.current.discard();
        return true;
      },
    };
  });

  // The cleanup matters on unmount: switching documents mid-stream would
  // otherwise leave the workspace believing a rewrite is still running.
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  // Mirror the state machine into the editor's overlay field, then place the
  // card against the resulting layout, all before paint. Positioning writes
  // the DOM directly instead of going through state, so a streamed token
  // costs one render, not two.
  const anchorRange = phase === 'idle' ? selection : range;
  // The overlay draws a replacing widget in exactly these phases; the others
  // only mark the untouched text, where the document positions are accurate.
  const widgetShown = phase === 'streaming' || (phase === 'reviewing' && error === null);
  useLayoutEffect(() => {
    view.dispatch({
      effects: setRewriteOverlay.of(
        phase === 'idle' || !range
          ? null
          : { range, phase, original, replacement, showDiff, error: error !== null },
      ),
    });
    const place = () => {
      const el = card.current;
      if (!el || !anchorRange) return;
      const at = anchorFor(view, anchorRange, widgetShown) ?? FALLBACK;
      const top = phase === 'idle' ? Math.max(4, at.top - PILL_HEIGHT - GAP) : at.bottom + GAP;
      el.style.top = `${top}px`;
      el.style.left = `${at.left}px`;
    };
    place();
    view.scrollDOM.addEventListener('scroll', place);
    return () => view.scrollDOM.removeEventListener('scroll', place);
  }, [view, phase, range, original, replacement, showDiff, error, anchorRange, widgetShown]);

  // Review keys work wherever focus landed after the prompt closed.
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        latest.current.discard();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        latest.current.accept();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  if (phase === 'idle' && (!enabled || !selection)) return null;

  return (
    <div ref={card} className="absolute z-20" style={{ top: FALLBACK.top, left: FALLBACK.left }}>
      {phase === 'idle' && (
        <button
          type="button"
          onClick={open}
          className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-white py-1 pl-2.5 pr-2 text-xs font-medium text-violet-700 shadow-md shadow-violet-900/10 hover:bg-violet-50"
        >
          <span aria-hidden>✦</span> Rewrite
          <kbd className="rounded bg-violet-50 px-1 font-sans text-[10px] text-violet-500">⌘K</kbd>
        </button>
      )}

      {phase === 'prompting' && (
        <RewritePrompt
          key={`${range?.from}-${range?.to}`}
          initialInstruction={instruction}
          onSubmit={submit}
          onCancel={discard}
        />
      )}

      {phase === 'streaming' && (
        <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-700 shadow-lg shadow-violet-900/10">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" aria-hidden />
          Rewriting…
          <button type="button" onClick={discard} className="ml-1 text-gray-500 hover:text-gray-800">
            ✕ Cancel
          </button>
        </div>
      )}

      {phase === 'reviewing' && (
        <RewriteReviewBar
          error={error}
          showDiff={showDiff}
          onToggleDiff={() => setShowDiff((d) => !d)}
          onAccept={accept}
          onDiscard={discard}
          onRetry={rewrite.retry}
        />
      )}
    </div>
  );
}
