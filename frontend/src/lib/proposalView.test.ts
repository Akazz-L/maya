import { describe, expect, it } from 'vitest';
import type { ChatProposal, Suggestion } from '../api/types';
import type { PendingProposal } from '../hooks/useChat';
import { proposalViewOf } from './proposalView';

const AGENTS = [{ key: 'continuity', label: 'Continuity check', hint: '' }];

const fix: Suggestion = {
  find: 'east',
  replace: 'west',
  explanation: 'The bible puts the marsh west.',
  severity: 'critical',
  from: 0,
  to: 4,
  outcome: null,
};

const pending = (proposal: ChatProposal, agent: string | null = null): PendingProposal => ({
  messageId: 'm1',
  proposal,
  agent,
});

describe('proposalViewOf', () => {
  it('is null with nothing streaming or pending', () => {
    expect(proposalViewOf(null, null, AGENTS)).toBeNull();
  });

  it('shows a streaming draft ahead of anything pending', () => {
    const view = proposalViewOf(
      { pendingUser: 'Draft it.', reply: '', progress: { mode: 'replace', text: 'One' } },
      null,
      AGENTS,
    );
    expect(view).toEqual({ phase: 'streaming', mode: 'replace', text: 'One' });
  });

  it('reviews a set of fixes under the name of the pass that made them', () => {
    const view = proposalViewOf(
      null,
      pending({ kind: 'suggestions', suggestions: [fix], base_hash: 'h' }, 'continuity'),
      AGENTS,
    );
    expect(view).toMatchObject({ phase: 'reviewing', kind: 'suggestions', label: 'Continuity check' });
  });

  it('reviews a whole-chapter rewrite as clean text first', () => {
    const view = proposalViewOf(
      null,
      pending({
        kind: 'write',
        mode: 'replace',
        text: 'New',
        base_hash: 'h',
        proposed_body: 'New',
        outcome: null,
      }),
      AGENTS,
    );
    expect(view).toEqual({
      phase: 'reviewing',
      kind: 'write',
      proposed: 'New',
      baseHash: 'h',
      showDiff: false,
    });
  });

  it('has nothing to review for a write whose body is gone', () => {
    const view = proposalViewOf(
      null,
      pending({
        kind: 'write',
        mode: 'replace',
        text: 'New',
        base_hash: 'h',
        proposed_body: null,
        outcome: null,
      }),
      AGENTS,
    );
    expect(view).toBeNull();
  });
});
