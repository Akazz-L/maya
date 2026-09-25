import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { generatePlan, type DocumentPatch } from '../api/endpoints';
import type { ScenePlan, UsageSnapshot } from '../api/types';
import { usePatchDocument } from './queries';

/** What the Undo bar would revert: a regenerate, or removing the plan. */
export type PlanUndo = 'regenerated' | 'removed';

interface ChapterPlanOptions {
  projectId: string;
  documentId: string | undefined;
  /** The open chapter's plan, as cached. */
  plan: ScenePlan | null;
  /** Saves every pending edit; the planner reads the saved chapter context. */
  settle: () => Promise<void>;
  save: (patch: DocumentPatch) => unknown;
  onUsage: (usage: UsageSnapshot | undefined) => void;
  /** A failure to show, or null to clear the last one when a new request starts. */
  onError: (message: string | null) => void;
}

/** The open chapter's scene plan: generate, edit by hand, remove, and undo either. */
export function useChapterPlan({
  projectId,
  documentId,
  plan,
  settle,
  save,
  onUsage,
  onError,
}: ChapterPlanOptions) {
  const patchDocument = usePatchDocument(projectId);
  // Tagged with its document, because a regenerate can finish after the writer moved on.
  const [undoState, setUndoState] = useState<{
    id: string;
    plan: ScenePlan;
    reason: PlanUndo;
  } | null>(null);

  // Takes the document id as its variable rather than reading the route: a
  // result that lands after the writer has switched documents belongs to the
  // document it was asked for, not the one now open.
  const mutation = useMutation({
    // Plan edits save immediately too, and a late one could otherwise land
    // after the new plan and restore the old one.
    mutationFn: (id: string) => settle().then(() => generatePlan(projectId, id)),
    onMutate: () => onError(null),
    onSuccess: (res, id) => {
      patchDocument(id, { plan: res.plan });
      onUsage(res.usage);
    },
    onError: (e: Error) => onError(e.message),
  });

  const setPlan = (next: ScenePlan | null) => {
    if (!documentId) return;
    patchDocument(documentId, { plan: next });
    save({ plan: next });
  };

  const clearUndo = () => setUndoState(null);

  /** Generate a plan, keeping the one it replaces so the writer can undo. */
  const generate = () => {
    if (!documentId) return;
    const id = documentId;
    const previous = plan;
    setUndoState(null);
    mutation.mutate(id, {
      onSuccess: () => {
        if (previous) setUndoState({ id, plan: previous, reason: 'regenerated' });
      },
    });
  };

  const edit = (next: ScenePlan) => {
    setUndoState(null);
    setPlan(next);
  };

  // Planning is optional: a stale or empty plan would otherwise keep steering
  // every chat draft and review.
  const remove = () => {
    if (!plan || !documentId) return;
    setUndoState({ id: documentId, plan, reason: 'removed' });
    setPlan(null);
  };

  // `setPlan` writes to the open document, so this only acts while that is still
  // the one the undo belongs to. The bar is hidden otherwise; the guard covers
  // the click that lands just after a switch.
  const undo = () => {
    if (!undoState || undoState.id !== documentId) return;
    setUndoState(null);
    setPlan(undoState.plan);
  };

  return {
    /** Any plan request in flight, for whichever document. */
    pending: mutation.isPending,
    /** A plan request in flight for the open document. */
    generating: mutation.isPending && mutation.variables === documentId,
    undoReason: undoState && undoState.id === documentId ? undoState.reason : null,
    generate,
    edit,
    remove,
    undo,
    clearUndo,
  };
}
