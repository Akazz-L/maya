import type { AgentOption } from '../api/types';
import type { ChatStreaming } from '../components/ChatPane';
import type { ProposalView } from '../components/ProposalLayer';
import type { PendingProposal } from '../hooks/useChat';

/**
 * What the editor should draw for the chat's current proposal: the draft
 * streaming in, a whole-chapter rewrite under review, or a pass's set of fixes.
 * Null when nothing is proposed.
 */
export function proposalViewOf(
  streaming: ChatStreaming | null,
  pending: PendingProposal | null,
  agents: AgentOption[],
): ProposalView | null {
  if (streaming?.progress) {
    return { phase: 'streaming', mode: streaming.progress.mode, text: streaming.progress.text };
  }
  if (pending?.proposal.kind === 'suggestions') {
    return {
      phase: 'reviewing',
      kind: 'suggestions',
      suggestions: pending.proposal.suggestions,
      baseHash: pending.proposal.base_hash,
      label: agents.find((a) => a.key === pending.agent)?.label,
    };
  }
  if (pending?.proposal.kind === 'write' && pending.proposal.proposed_body !== null) {
    return {
      phase: 'reviewing',
      kind: 'write',
      proposed: pending.proposal.proposed_body,
      baseHash: pending.proposal.base_hash,
      // A new draft shown against the old one is noise.
      showDiff: false,
    };
  }
  return null;
}
