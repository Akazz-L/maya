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
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  // Filled by the editor: saves a title or body edit still inside the debounce.
  const editorFlush = useRef<(() => void) | null>(null);
  // The chapter context edit waiting out its own debounce, with the document it belongs to.
  const contextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextPending = useRef<{ id: string; value: string } | null>(null);

  /** Saves to one named document, so a late flush lands where it was typed. */
  const saveTo = useCallback(
    (id: string, patch: DocumentPatch) => {
      setSaveState('saving');
      const promise = updateDocument(projectId, id, patch)
        .then((saved) => {
          qc.setQueryData(documentKey(projectId, id), saved);
          if (patch.title !== undefined) {
            qc.invalidateQueries({ queryKey: documentsKey(projectId) });
          }
          setSaveState('saved');
        })
        .catch(() => setSaveState('error'));
      // Chained rather than replaced: a context save and a body save can be in
      // flight at once, and a request that reads the document must await both.
      pendingSave.current = Promise.all([pendingSave.current, promise]);
      return promise;
    },
    [projectId, qc],
  );

  const save = useCallback(
    (patch: DocumentPatch) => (documentId ? saveTo(documentId, patch) : Promise.resolve()),
    [documentId, saveTo],
  );

  const flushContext = useCallback(() => {
    const patch = contextPending.current;
    contextPending.current = null;
    if (contextTimer.current) {
      clearTimeout(contextTimer.current);
      contextTimer.current = null;
    }
    if (patch) saveTo(patch.id, { brief: patch.value });
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
