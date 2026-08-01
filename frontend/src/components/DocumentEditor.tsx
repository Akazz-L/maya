import { useEffect, useRef, useState } from 'react';
import type { DocumentDetail } from '../api/types';

export const AUTOSAVE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface EditorPatch {
  title?: string;
  body?: string;
  brief?: string;
}

interface DocumentEditorProps {
  document: DocumentDetail;
  readOnly: boolean;
  onSave: (patch: EditorPatch) => void;
  saveState: SaveState;
  /** Live text during a stream. Bypasses local state so the server stays authoritative. */
  bodyOverride?: string;
}

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
  readOnly,
  onSave,
  saveState,
  bodyOverride,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [brief, setBrief] = useState(document.brief);
  const [body, setBody] = useState(document.body);

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

      {document.kind === 'chapter' && (
        <input
          value={brief}
          placeholder="What happens in this chapter…"
          aria-label="Chapter brief"
          onChange={(e) => {
            setBrief(e.target.value);
            queueSave({ brief: e.target.value });
          }}
          className="border-b border-gray-200 bg-[#fcfcfa] px-6 py-2 text-sm text-gray-600 outline-none"
        />
      )}

      <textarea
        value={bodyOverride ?? body}
        disabled={readOnly}
        aria-label="Document body"
        onChange={(e) => {
          setBody(e.target.value);
          queueSave({ body: e.target.value });
        }}
        className="flex-1 resize-none bg-white px-6 py-6 font-serif text-[15px] leading-[1.8] text-gray-800 outline-none disabled:bg-gray-50"
      />
    </main>
  );
}
