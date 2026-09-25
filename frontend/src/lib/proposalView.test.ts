import { describe, expect, it } from 'vitest';
import type { ChatProposal, Suggestion } from '../api/types';
import type { PendingProposal } from '../hooks/useChat';
import { toProposalView } from './proposalView';

const AGENTS = [{ key: 'continuity', label: 'Continuity check', hint: '' }];

const fix: Suggestion = {
  find: 'blue',
  replace: 'green',
  explanation: 'Her eyes are green in chapter 1.',
  severity: 'critical',
  from: 0,
  to: 4,
  outcome: null,
};

function pending(proposal: ChatProposal, agent: string | null = null): PendingProposal {
  return { messageId: 'm1', proposal, agent };
}

const write = (proposed_body: string | null): ChatProposal => ({
  kind: 'write',
  mode: 'replace',
  text: 'New.',
  proposed_body,
  outcome: null,
  base_hash: 'h',
});

describe('toProposalView', () => {
  it('shows nothing without a stream or a pending proposal', () => {
    expect(toProposalView(null, null, AGENTS)).toBeNull();
  });

  it('shows a draft streaming in ahead of any stored proposal', () => {
    const streaming = {
      pendingUser: 'Draft it',
      reply: '',
      progress: { mode: 'append' as const, text: 'Once' },
    };
    expect(toProposalView(streaming, pending(write('Old.')), AGENTS)).toEqual({
      phase: 'streaming',
      mode: 'append',
      text: 'Once',
    });
  });

  it('ignores a reply that streams without a proposal', () => {
    const streaming = { pendingUser: 'Hi', reply: 'Hello', progress: null };
    expect(toProposalView(streaming, null, AGENTS)).toBeNull();
  });

  it('reviews a whole-chapter proposal as the clean text first', () => {
    expect(toProposalView(null, pending(write('New body.')), AGENTS)).toEqual({
      phase: 'reviewing',
      kind: 'write',
      proposed: 'New body.',
      baseHash: 'h',
      showDiff: false,
    });
  });

  it('has nothing to draw for a resolved write proposal', () => {
    expect(toProposalView(null, pending(write(null)), AGENTS)).toBeNull();
  });

  it('names a review set by the specialist that proposed it', () => {
    const set: ChatProposal = { kind: 'suggestions', suggestions: [fix], base_hash: 'h' };
    expect(toProposalView(null, pending(set, 'continuity'), AGENTS)).toMatchObject({
      kind: 'suggestions',
      suggestions: [fix],
      label: 'Continuity check',
    });
    expect(toProposalView(null, pending(set, null), AGENTS)).toMatchObject({ label: undefined });
  });
});
