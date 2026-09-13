// A chapter's conversation: the stored messages, the reply streaming in, and
// the proposal awaiting review. The stream aborts on unmount and whenever the
// open document changes, so a reply never lands in the wrong chapter.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chatStreamUrl, clearChat, getChat, resolveProposal } from '../api/endpoints';
import { streamPost } from '../api/stream';
import type { ChatMessage, ChatProposal, ProposalOutcome, UsageSnapshot } from '../api/types';
import type { ChatStreaming } from '../components/ChatPane';

export const chatKey = (projectId: string, documentId: string) =>
  ['chat', projectId, documentId] as const;

export interface PendingProposal {
  messageId: string;
  proposal: ChatProposal;
}

interface UseChatOptions {
  projectId: string;
  documentId: string | undefined;
  /** Chapters only; nothing is fetched otherwise. */
  enabled: boolean;
  /** Runs before a message is sent: the server reads the saved chapter. */
  beforeSend: () => Promise<void>;
  onUsage: (usage: UsageSnapshot | undefined) => void;
  /** A message failed; the cached meter may be stale. */
  onFailure?: () => void;
}

export function useChat({ projectId, documentId, enabled, beforeSend, onUsage, onFailure }: UseChatOptions) {
  const qc = useQueryClient();
  const id = documentId ?? '';
  const key = chatKey(projectId, id);

  const query = useQuery({
    queryKey: key,
    queryFn: () => getChat(projectId, id).then((r) => r.messages),
    enabled: enabled && Boolean(documentId),
  });

  // Scoped to the document they belong to, so switching chapters shows none of
  // the previous one's stream or error without an effect to reset them.
  const [stream, setStream] = useState<{ id: string; state: ChatStreaming } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Accept followed by a quick Discard must not both reach the server.
  const resolving = useRef(new Set<string>());

  const callbacks = useRef({ beforeSend, onUsage, onFailure });
  useEffect(() => {
    callbacks.current = { beforeSend, onUsage, onFailure };
  });

  useEffect(() => () => abortRef.current?.abort(), [projectId, documentId]);

  const messages = useMemo(() => query.data ?? [], [query.data]);

  const pendingProposal = useMemo<PendingProposal | null>(() => {
    const last = messages[messages.length - 1];
    return last?.proposal && last.proposal.outcome === null
      ? { messageId: last.id, proposal: last.proposal }
      : null;
  }, [messages]);

  const update = useCallback(
    (fn: (old: ChatMessage[]) => ChatMessage[]) =>
      qc.setQueryData(chatKey(projectId, id), (old?: ChatMessage[]) => fn(old ?? [])),
    [qc, projectId, id],
  );

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      if (!id) return false;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const patch = (fn: (s: ChatStreaming) => ChatStreaming) =>
        setStream((s) => (s && s.id === id ? { id, state: fn(s.state) } : s));

      setError(null);
      setStream({ id, state: { pendingUser: content, reply: '', progress: null } });
      let delivered = false;
      try {
        await callbacks.current.beforeSend();
        await streamPost(
          chatStreamUrl(projectId, id),
          { content },
          {
            onDelta: (text) => patch((s) => ({ ...s, reply: s.reply + text })),
            onProposalProgress: (progress) => patch((s) => ({ ...s, progress })),
            onDone: (_body, usage, frame) => {
              update((old) => [...old, ...(frame?.messages ?? [])]);
              callbacks.current.onUsage(usage);
              delivered = true;
            },
          },
          controller.signal,
        );
      } catch (e) {
        if (!controller.signal.aborted) {
          setError({ id, message: (e as Error).message });
          callbacks.current.onFailure?.();
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStream(null);
        }
      }
      return delivered;
    },
    [projectId, id, update],
  );

  const resolve = useCallback(
    async (messageId: string, outcome: ProposalOutcome) => {
      if (resolving.current.has(messageId)) return;
      resolving.current.add(messageId);
      try {
        const updated = await resolveProposal(projectId, id, messageId, outcome);
        update((old) => old.map((m) => (m.id === updated.id ? updated : m)));
      } catch (e) {
        setError({ id, message: (e as Error).message });
      } finally {
        resolving.current.delete(messageId);
      }
    },
    [projectId, id, update],
  );

  const clear = useCallback(async () => {
    try {
      await clearChat(projectId, id);
      update(() => []);
    } catch (e) {
      setError({ id, message: (e as Error).message });
    }
  }, [projectId, id, update]);

  return {
    messages,
    loading: query.isLoading,
    streaming: stream?.id === id ? stream.state : null,
    error: error?.id === id ? error.message : (query.error?.message ?? null),
    pendingProposal,
    send,
    resolve,
    clear,
  };
}
