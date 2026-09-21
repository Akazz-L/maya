// What the editor draws for the chat's current proposal, derived from the
// chat's state rather than stored beside it.
import type { AgentOption, Suggestion } from '../api/types';
import type { ChatStreaming } from '../components/ChatPane';
import type { PendingProposal } from '../hooks/useChat';

export type ProposalView =
  | { phase: 'streaming'; mode: 'replace' | 'append' | null; text: string }
  | {
      phase: 'reviewing';
      kind: 'write';
      /** The whole chapter as the proposal would leave it. */
      proposed: string;
      /** sha256 of the body the proposal was computed against. */
      baseHash: string;
      /** Where the review starts: a diff suits edits, the clean text a new draft. */
      showDiff: boolean;
    }
  | {
      phase: 'reviewing';
      kind: 'suggestions';
      /** Every fix the pass proposed, resolved ones included, so a card can
       *  number itself the way the chat message counts them. */
      suggestions: Suggestion[];
      baseHash: string;
      /** What the pass is called, for the review bar: "Continuity check". */
      label?: string;
    };

/**
 * The proposal to show in the chapter: a draft streaming in, or a stored one
 * waiting for review. Null when there is nothing to draw.
 */
export function toProposalView(
  streaming: ChatStreaming | null,
  pending: PendingProposal | null,
  agents: AgentOption[],
): ProposalView | null {
  if (streaming?.progress) {
    return { phase: 'streaming', mode: streaming.progress.mode, text: streaming.progress.text };
  }
  const proposal = pending?.proposal;
  if (proposal?.kind === 'suggestions') {
    return {
      phase: 'reviewing',
      kind: 'suggestions',
      suggestions: proposal.suggestions,
      baseHash: proposal.base_hash,
      label: agents.find((a) => a.key === pending?.agent)?.label,
    };
  }
  if (proposal?.kind === 'write' && proposal.proposed_body !== null) {
    return {
      phase: 'reviewing',
      kind: 'write',
      proposed: proposal.proposed_body,
      baseHash: proposal.base_hash,
      // A new draft shown against the old one is noise.
      showDiff: false,
    };
  }
  return null;
}
