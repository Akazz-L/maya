import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateDocument, type DocumentPatch } from '../api/endpoints';
import { documentKey, documentsKey } from './queries';

/** How long typing must pause before an edit is saved. */
export const AUTOSAVE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type SaveTo = (id: string, patch: DocumentPatch) => unknown;

/**
 * A text field of the open document that the editor does not own, debounced.
 *
 * The chapter context and the chapter summary both work this way: two views can
 * show the same text, so the edit lives above them, and it is saved to the
 * document it was typed in even if the writer has since opened another.
 */
function useDebouncedField(
  field: 'brief' | 'summary',
  documentId: string | undefined,
  serverValue: string,
  saveTo: SaveTo,
) {
  // Tagged with its document, so switching documents falls back to what the
  // server sent for the new one.
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ id: string; value: string } | null>(null);

  const flush = useCallback(() => {
    const patch = pending.current;
    pending.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (patch) saveTo(patch.id, { [field]: patch.value });
  }, [field, saveTo]);

  // Switching documents mid-debounce must save rather than drop the edit; the
  // pending record carries its own document id, so it still lands correctly.
  useEffect(() => () => flush(), [documentId, flush]);

  const change = (value: string) => {
    if (!documentId) return;
    const next = { id: documentId, value };
    setEdit(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  };

  /** Drop the local edit, so the server's own text shows again. */
  const reset = () => setEdit(null);

  return {
    value: edit && edit.id === documentId ? edit.value : serverValue,
    change,
    flush,
    reset,
  };
}

/**
 * Everything that puts the writer's text on the server: the editor's autosave,
 * the chapter context's and the summary's own debounces, and `settle`, which a
 * request that reads the document server-side awaits first.
 *
 * `serverContext` and `serverSummary` are those fields as the server last sent them.
 */
export function useDocumentSaving(
  projectId: string,
  documentId: string | undefined,
  serverContext: string,
  serverSummary: string,
) {
  const qc = useQueryClient();
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Holds the in-flight autosaves so a request that reads the document
  // server-side can wait for them to land. Without this the server works from a
  // stale body and the writer's last keystrokes vanish.
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  // Whether the server's copy is known to be behind: set when a save fails,
  // cleared when one succeeds. `settle` refuses on it, because waiting for a
  // save that failed leaves the document just as stale as not waiting at all.
  const saveFailed = useRef(false);
  // Filled by the editor: saves a title or body edit still inside the debounce.
  const editorFlush = useRef<(() => void) | null>(null);

  /** Saves to one named document, so a late flush lands where it was typed. */
  const saveTo = useCallback(
    (id: string, patch: DocumentPatch) => {
      setSaveState('saving');
      // Resolves to whether the write landed. It never rejects: most saves are
      // fire-and-forget, and a rejection nobody awaits is an unhandled one.
      const promise = updateDocument(projectId, id, patch)
        .then((saved) => {
          qc.setQueryData(documentKey(projectId, id), saved);
          if (patch.title !== undefined) {
            qc.invalidateQueries({ queryKey: documentsKey(projectId) });
          }
          saveFailed.current = false;
          setSaveState('saved');
          return true;
        })
        .catch(() => {
          saveFailed.current = true;
          setSaveState('error');
          return false;
        });
      // Chained rather than replaced: a context save and a body save can be in
      // flight at once, and a request that reads the document must await both.
      // Collapsed to void so the chain does not carry every past result.
      pendingSave.current = Promise.all([pendingSave.current, promise]).then(() => undefined);
      return promise;
    },
    [projectId, qc],
  );

  const save = useCallback(
    (patch: DocumentPatch) => (documentId ? saveTo(documentId, patch) : Promise.resolve(false)),
    [documentId, saveTo],
  );

  const context = useDebouncedField('brief', documentId, serverContext, saveTo);
  const summary = useDebouncedField('summary', documentId, serverSummary, saveTo);

  /**
   * Put everything the writer has typed on the server before a request reads it
   * there. Awaiting only the in-flight saves is not enough: an edit still inside
   * a debounce has not been sent at all.
   */
  const settle = useCallback(async () => {
    editorFlush.current?.();
    context.flush();
    summary.flush();
    await pendingSave.current;
    if (saveFailed.current) {
      throw new Error('Your last changes could not be saved, so this would work from older text.');
    }
  }, [context, summary]);

  return {
    saveState,
    saveTo,
    save,
    settle,
    editorFlush,
    context: context.value,
    changeContext: context.change,
    summary: summary.value,
    changeSummary: summary.change,
    /** After a regenerate: show the model's summary rather than the last edit. */
    resetSummary: summary.reset,
  };
}
