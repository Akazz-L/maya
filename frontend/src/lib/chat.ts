// Pure helpers for the chapter chat. No React, no network, no CodeMirror.
import type { ChatProposal, ProposalOutcome } from '../api/types';

export interface Span {
  from: number;
  to: number;
  insert: string;
}

/**
 * The smallest single change turning `base` into `proposed`: the common prefix
 * and suffix are left alone. The review overlay draws only this span, and
 * Accept replaces only this span, so the writer's cursor and the undo history
 * see a local edit rather than a whole-document swap.
 */
export function changedSpan(base: string, proposed: string): Span {
  const max = Math.min(base.length, proposed.length);
  let start = 0;
  while (start < max && base[start] === proposed[start]) start++;
  let end = 0;
  while (
    end < max - start &&
    base[base.length - 1 - end] === proposed[proposed.length - 1 - end]
  ) {
    end++;
  }
  return {
    from: start,
    to: base.length - end,
    insert: proposed.slice(start, proposed.length - end),
  };
}

/**
 * The chapter as it would read with the prose streamed so far. Joins an
 * append the way the server does, so the streamed view and the final proposal
 * agree. Before the mode arrives, the text is shown as a replacement.
 */
export function streamingBody(
  base: string,
  mode: 'replace' | 'append' | null,
  text: string,
): string {
  if (mode !== 'append' || !base.trim()) return text;
  return `${base.trimEnd()}\n\n${text.trimStart()}`;
}

/** Hex sha256 of the text, matching the server's hash of a document body. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function describeProposal(proposal: ChatProposal): string {
  if (proposal.kind === 'write') {
    const label = proposal.mode === 'replace' ? 'New draft' : 'Continuation';
    return `${label} · ${wordCount(proposal.text)} words`;
  }
  const n = proposal.edits.length;
  return `${n} edit${n === 1 ? '' : 's'}`;
}

export function outcomeLabel(outcome: ProposalOutcome | null): string {
  switch (outcome) {
    case null:
      return 'Awaiting review in the editor';
    case 'accepted':
      return 'Accepted';
    case 'discarded':
      return 'Discarded';
    case 'stale':
      return 'Not applied — the chapter changed first';
  }
}
