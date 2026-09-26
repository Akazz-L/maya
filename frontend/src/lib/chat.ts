// Pure helpers for the chapter chat. No React, no network, no CodeMirror.
import type { ChatProposal, ProposalOutcome, Suggestion } from '../api/types';

/** One fix as the editor currently holds it: its live span, plus its place in
 *  the stored set, which is how an outcome is recorded. */
export interface LiveFix {
  /** Position in the proposal's `suggestions` array. */
  index: number;
  from: number;
  to: number;
  find: string;
  replace: string;
  explanation: string;
  severity: Suggestion['severity'];
}

/** Whether a proposal still awaits the writer: a draft with no outcome, or a set
 *  with any fix left unreviewed. Mirrors the server's own gate. */
export function isPending(proposal: ChatProposal): boolean {
  return proposal.kind === 'suggestions'
    ? proposal.suggestions.some((s) => s.outcome === null)
    : proposal.outcome === null;
}

/** The fixes still awaiting review, at the offsets the proposal was built on. */
export function liveFixes(suggestions: Suggestion[]): LiveFix[] {
  return suggestions
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.outcome === null)
    .map(({ index, from, to, find, replace, explanation, severity }) => ({
      index,
      from,
      to,
      find,
      replace,
      explanation,
      severity,
    }));
}

/**
 * The remaining fixes after one of them has been spliced in.
 *
 * Fixes never overlap, so a fix that starts at or after the accepted span moves
 * by the length the splice added or removed, and one before it does not move at
 * all. Accepting out of order therefore works as well as in order.
 */
export function shiftFixes(
  fixes: LiveFix[],
  applied: { from: number; to: number; insert: string },
): LiveFix[] {
  const delta = applied.insert.length - (applied.to - applied.from);
  return fixes.map((fix) =>
    fix.from >= applied.to ? { ...fix, from: fix.from + delta, to: fix.to + delta } : fix,
  );
}

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
  while (end < max - start && base[base.length - 1 - end] === proposed[proposed.length - 1 - end]) {
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
  const n = proposal.suggestions.length;
  return `${n} suggested fix${n === 1 ? '' : 'es'}`;
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

/**
 * How a suggestion set reads once the writer has worked through it: "2 kept, 1
 * discarded", or what is left to review. Counts rather than a per-fix list — the
 * detail lives on the cards in the prose.
 */
export function outcomeSummary(suggestions: Suggestion[]): string {
  const count = (outcome: ProposalOutcome | null) =>
    suggestions.filter((s) => s.outcome === outcome).length;
  const pending = count(null);
  if (pending) {
    return pending === suggestions.length
      ? 'Awaiting review in the chapter'
      : `${pending} still awaiting review in the chapter`;
  }
  const parts = [
    count('accepted') && `${count('accepted')} kept`,
    count('discarded') && `${count('discarded')} discarded`,
    count('stale') && `${count('stale')} not applied — the chapter changed first`,
  ].filter(Boolean);
  return parts.join(' · ');
}
