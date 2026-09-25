import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateDocument, type DocumentPatch } from '../api/endpoints';
import { documentKey, documentsKey } from './queries';

/** How long typing must pause before an edit is saved. */
export const AUTOSAVE_MS = 800;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Everything that puts the writer's text on the server: the editor's autosave,
 * the chapter context's own debounce, and `settle`, which a request that reads
 * the document server-side awaits first.
 *
 * `serverContext` is the chapter context as the server last sent it.
 */
export function useDocumentSaving(
  projectId: string,
  documentId: string | undefined,
  serverContext: string,
) {
  const qc = useQueryClient();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // The chapter context as the writer is typing it. It lives here rather than in
  // the editor because the Plan view edits the same text; tagged with its
  // document, so switching documents falls back to what the server sent.
  const [contextEdit, setContextEdit] = useState<{ id: string; value: string } | null>(null);

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
  // The chapter context edit waiting out its own debounce, with the document it belongs to.
  const contextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextPending = useRef<{ id: string; value: string } | null>(null);

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

  const flushContext = useCallback(() => {
    const patch = contextPending.current;
    contextPending.current = null;
    if (contextTimer.current) {
      clearTimeout(contextTimer.current);
      contextTimer.current = null;
    }
    if (!patch) return;
    void saveTo(patch.id, { brief: patch.value }).then((ok) => {
      // Once the server holds this text, stop shadowing it, so a later change
      // from elsewhere — an AI edit, another tab — is visible again. Only if it
      // is still what the writer typed: newer keystrokes must not be discarded,
      // and a failed save must keep showing the text that did not reach the server.
      if (!ok) return;
      setContextEdit((current) =>
        current && current.id === patch.id && current.value === patch.value ? null : current,
      );
    });
  }, [saveTo]);

  // Switching documents mid-debounce must save rather than drop the edit; the
  // pending record carries its own document id, so it still lands correctly.
  useEffect(() => () => flushContext(), [documentId, flushContext]);

  /**
   * Put everything the writer has typed on the server before a request reads it
   * there. Awaiting only the in-flight saves is not enough: an edit still inside
   * a debounce has not been sent at all.
   */
  const settle = useCallback(async () => {
    editorFlush.current?.();
    flushContext();
    await pendingSave.current;
    if (saveFailed.current) {
      throw new Error('Your last changes could not be saved, so this would work from older text.');
    }
  }, [flushContext]);

  const context = contextEdit && contextEdit.id === documentId ? contextEdit.value : serverContext;

  const changeContext = (value: string) => {
    if (!documentId) return;
    const edit = { id: documentId, value };
    setContextEdit(edit);
    contextPending.current = edit;
    if (contextTimer.current) clearTimeout(contextTimer.current);
    contextTimer.current = setTimeout(flushContext, AUTOSAVE_MS);
  };

  return { saveState, saveTo, save, settle, editorFlush, context, changeContext };
}
