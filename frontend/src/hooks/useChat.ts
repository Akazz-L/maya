// A chapter's conversation: the stored messages, the reply streaming in, and
// the proposal awaiting review. The stream aborts on unmount and whenever the
// open document changes, so a reply never lands in the wrong chapter.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { chatStreamUrl, clearChat, getChat, listAgents, resolveProposal } from '../api/endpoints';
import { streamPost } from '../api/stream';
import type { ChatMessage, ChatProposal, ProposalOutcome, UsageSnapshot } from '../api/types';
import type { ChatStreaming } from '../components/ChatPane';
import { isPending } from '../lib/chat';

export const chatKey = (projectId: string, documentId: string) =>
  ['chat', projectId, documentId] as const;

export const agentsKey = ['agents'] as const;

export interface PendingProposal {
  messageId: string;
  proposal: ChatProposal;
  /** The specialist that proposed it, for the review bar's title. */
  agent: string | null;
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

export function useChat({
  projectId,
  documentId,
  enabled,
  beforeSend,
  onUsage,
  onFailure,
}: UseChatOptions) {
  const qc = useQueryClient();
  const id = documentId ?? '';
  const key = chatKey(projectId, id);

  const query = useQuery({
    queryKey: key,
    queryFn: () => getChat(projectId, id).then((r) => r.messages),
    enabled: enabled && Boolean(documentId),
  });

  // The specialist catalogue is the same for every chapter and never changes
  // within a session, so it is fetched once and shared.
  const agents = useQuery({
    queryKey: agentsKey,
    queryFn: listAgents,
    enabled,
    staleTime: Infinity,
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
    return last?.proposal && isPending(last.proposal)
      ? { messageId: last.id, proposal: last.proposal, agent: last.agent }
      : null;
  }, [messages]);

  const update = useCallback(
    (fn: (old: ChatMessage[]) => ChatMessage[]) =>
      qc.setQueryData(chatKey(projectId, id), (old?: ChatMessage[]) => fn(old ?? [])),
    [qc, projectId, id],
  );

  const post = useCallback(
    async (body: { content: string } | { agent: string }, shown: string): Promise<boolean> => {
      if (!id) return false;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const patch = (fn: (s: ChatStreaming) => ChatStreaming) =>
        setStream((s) => (s && s.id === id ? { id, state: fn(s.state) } : s));

      setError(null);
      setStream({ id, state: { pendingUser: shown, reply: '', progress: null } });
      let delivered = false;
      try {
        await callbacks.current.beforeSend();
        await streamPost(
          chatStreamUrl(projectId, id),
          body,
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

  const send = useCallback((content: string) => post({ content }, content), [post]);

  /** Run a specialist pass. The server supplies the turn's wording. */
  const run = useCallback(
    (agent: string) => {
      const label = agents.data?.find((a) => a.key === agent)?.label ?? 'Specialist';
      return post({ agent }, `${label}…`);
    },
    [post, agents.data],
  );

  const resolve = useCallback(
    async (messageId: string, outcome: ProposalOutcome, indexes?: number[]) => {
      // One in-flight call per message: accepting two fixes in quick succession
      // must not have the second overwrite the first's outcome.
      const token = `${messageId}:${indexes?.join(',') ?? 'all'}`;
      if (resolving.current.has(token)) return;
      resolving.current.add(token);
      try {
        const updated = await resolveProposal(projectId, id, messageId, outcome, indexes);
        update((old) => old.map((m) => (m.id === updated.id ? updated : m)));
      } catch (e) {
        setError({ id, message: (e as Error).message });
      } finally {
        resolving.current.delete(token);
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
    agents: agents.data ?? [],
    send,
    run,
    resolve,
    clear,
  };
}
