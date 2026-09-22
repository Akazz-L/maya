import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateDocument, type DocumentPatch } from '../api/endpoints';
import { AUTOSAVE_MS, type SaveState } from '../components/DocumentEditor';
import { documentKey, documentsKey } from './queries';

/**
 * Everything the workspace does to get the writer's typing onto the server,
 * and to be sure it has landed before a request reads the document there.
 *
 * Two editors feed it. The document editor debounces its own title and body
 * edits and hands over a flush function through `editorFlush`. The chapter
 * context is debounced here, because the Write and Plan views edit the same
 * text and it has to outlive either of them.
 */
export function useDocumentSaving(projectId: string, documentId: string | undefined) {
  const qc = useQueryClient();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // The chapter context as the writer is typing it, tagged with its document so
  // switching documents falls back to what the server sent.
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

  const changeContext = useCallback(
    (value: string) => {
      if (!documentId) return;
      setContextEdit({ id: documentId, value });
      contextPending.current = { id: documentId, value };
      if (contextTimer.current) clearTimeout(contextTimer.current);
      contextTimer.current = setTimeout(flushContext, AUTOSAVE_MS);
    },
    [documentId, flushContext],
  );

  /** The chapter context to show: the writer's unsaved edit, else the server's copy. */
  const contextFor = (serverValue: string | undefined) =>
    contextEdit && contextEdit.id === documentId ? contextEdit.value : (serverValue ?? '');

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

  return { saveState, save, settle, editorFlush, changeContext, contextFor };
}
