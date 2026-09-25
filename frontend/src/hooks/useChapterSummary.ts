import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateSummary, getSummaryContext } from '../api/endpoints';
import type { UsageSnapshot } from '../api/types';
import { usePatchDocument } from './queries';

export const summaryContextKey = (projectId: string, documentId: string) =>
  ['summary-context', projectId, documentId] as const;

interface ChapterSummaryOptions {
  projectId: string;
  documentId: string | undefined;
  enabled: boolean;
  /** Saves every pending edit; the summarizer reads the chapter as saved. */
  settle: () => Promise<void>;
  /** Drops the local edit, so the model's new summary is what shows. */
  resetEdit: () => void;
  onUsage: (usage: UsageSnapshot | undefined) => void;
  /** A failure to show, or null to clear the last one when a new request starts. */
  onError: (message: string | null) => void;
}

/**
 * The open chapter's summary: what earlier chapters it reads, and summarizing
 * this one on request.
 *
 * Editing the text is an ordinary document save, handled by useDocumentSaving.
 * Only the model call lives here.
 */
export function useChapterSummary({
  projectId,
  documentId,
  enabled,
  settle,
  resetEdit,
  onUsage,
  onError,
}: ChapterSummaryOptions) {
  const qc = useQueryClient();
  const patchDocument = usePatchDocument(projectId);

  // The chapters this one reads. Free to ask for, and it changes whenever a
  // summary is written, so it is refetched rather than derived.
  const sources = useQuery({
    queryKey: summaryContextKey(projectId, documentId ?? ''),
    queryFn: () => getSummaryContext(projectId, documentId!),
    enabled: enabled && !!documentId,
  });

  // Takes the document id as its variable rather than reading the route: a
  // summary that lands after the writer has switched documents belongs to the
  // document it was asked for.
  const mutation = useMutation({
    mutationFn: (id: string) => settle().then(() => generateSummary(projectId, id)),
    onMutate: () => onError(null),
    onSuccess: (res, id) => {
      patchDocument(id, { summary: res.summary, summary_status: res.summary_status });
      resetEdit();
      onUsage(res.usage);
      // Any chapter after this one now reads a different summary of it.
      void qc.invalidateQueries({ queryKey: ['summary-context', projectId] });
    },
    onError: (e: Error) => onError(e.message),
  });

  return {
    sources: sources.data?.previous ?? [],
    generating: mutation.isPending,
    generate: () => {
      if (documentId) mutation.mutate(documentId);
    },
  };
}
