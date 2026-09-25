import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateDigest, generateSummary, getSummaryContext } from '../api/endpoints';
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
  /** Drops the local edits, so the model's new text is what shows. */
  resetEdit: () => void;
  resetDigestEdit: () => void;
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
  resetDigestEdit,
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

  // Same shape, different artifact: the story so far is the record of every
  // chapter before the recent ones, and is rebuilt rather than refreshed.
  const digest = useMutation({
    mutationFn: (id: string) => settle().then(() => generateDigest(projectId, id)),
    onMutate: () => onError(null),
    onSuccess: (res, id) => {
      patchDocument(id, { digest: res.digest });
      resetDigestEdit();
      onUsage(res.usage);
      void qc.invalidateQueries({ queryKey: ['summary-context', projectId] });
    },
    onError: (e: Error) => onError(e.message),
  });

  return {
    context: sources.data ?? null,
    generating: mutation.isPending,
    generate: () => {
      if (documentId) mutation.mutate(documentId);
    },
    digestStatus: sources.data?.digest?.status ?? 'empty',
    digestCovers: sources.data?.digest?.covers ?? [],
    digestGenerating: digest.isPending,
    generateDigest: () => {
      if (documentId) digest.mutate(documentId);
    },
  };
}
