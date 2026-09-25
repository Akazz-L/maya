import { describe, expect, it } from 'vitest';
import type { ChatProposal, ProposalOutcome, Suggestion } from '../api/types';
import {
  changedSpan,
  describeProposal,
  isPending,
  liveFixes,
  outcomeLabel,
  outcomeSummary,
  sha256Hex,
  shiftFixes,
  streamingBody,
  type LiveFix,
} from './chat';

/** One stored suggestion, numbered so its find/replace are recognisable. */
function fix(n: number, outcome: ProposalOutcome | null = null): Suggestion {
  return {
    find: `find${n}`,
    replace: `replace${n}`,
    explanation: `because ${n}`,
    severity: null,
    from: n * 10,
    to: n * 10 + 5,
    outcome,
  };
}

const apply = (base: string, proposed: string) => {
  const { from, to, insert } = changedSpan(base, proposed);
  return base.slice(0, from) + insert + base.slice(to);
};

describe('changedSpan', () => {
  it('covers only the part that changed', () => {
    expect(changedSpan('The rain fell.', 'The downpour fell.')).toEqual({
      from: 4,
      to: 8,
      insert: 'downpour',
    });
  });

  it('is an insertion at the end for an append', () => {
    expect(changedSpan('Existing.', 'Existing.\n\nMore.')).toEqual({
      from: 9,
      to: 9,
      insert: '\n\nMore.',
    });
  });

  it('is empty when nothing changed', () => {
    expect(changedSpan('Same.', 'Same.')).toEqual({ from: 5, to: 5, insert: '' });
  });

  it.each([
    ['abc', 'xyz'],
    ['aaa', 'aa'],
    ['aa', 'aaa'],
    ['', 'New.'],
    ['Old.', ''],
    ['One. Two. Three.', 'One. Three.'],
  ])('always rebuilds the proposed text from %j to %j', (base, proposed) => {
    expect(apply(base, proposed)).toBe(proposed);
  });
});

describe('streamingBody', () => {
  it('is the streamed text for a replace, or before the mode is known', () => {
    expect(streamingBody('Old.', 'replace', 'New')).toBe('New');
    expect(streamingBody('Old.', null, 'New')).toBe('New');
  });

  it('follows the existing text after a blank line for an append, as the server joins it', () => {
    expect(streamingBody('Existing.\n', 'append', 'More')).toBe('Existing.\n\nMore');
    expect(streamingBody('  ', 'append', 'First')).toBe('First');
  });
});

describe('sha256Hex', () => {
  it('matches the standard digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('describeProposal', () => {
  const base = { base_hash: 'h', proposed_body: null, outcome: null };

  it('names the kind of change', () => {
    const draft: ChatProposal = { ...base, kind: 'write', mode: 'replace', text: 'one two three' };
    const more: ChatProposal = { ...base, kind: 'write', mode: 'append', text: 'four five' };
    const one: ChatProposal = { base_hash: 'h', kind: 'suggestions', suggestions: [fix(0)] };
    const two: ChatProposal = { ...one, suggestions: [fix(0), fix(1)] };
    expect(describeProposal(draft)).toBe('New draft · 3 words');
    expect(describeProposal(more)).toBe('Continuation · 2 words');
    expect(describeProposal(one)).toBe('1 suggested fix');
    expect(describeProposal(two)).toBe('2 suggested fixes');
  });

  it('says what became of it', () => {
    expect(outcomeLabel(null)).toBe('Awaiting review in the editor');
    expect(outcomeLabel('accepted')).toBe('Accepted');
    expect(outcomeLabel('discarded')).toBe('Discarded');
    expect(outcomeLabel('stale')).toBe('Not applied — the chapter changed first');
  });
});

describe('isPending', () => {
  const set = (...outcomes: (ProposalOutcome | null)[]): ChatProposal => ({
    base_hash: 'h',
    kind: 'suggestions',
    suggestions: outcomes.map((outcome, n) => fix(n, outcome)),
  });

  it('holds while any one fix is unreviewed', () => {
    expect(isPending(set(null, null))).toBe(true);
    expect(isPending(set('accepted', null))).toBe(true);
    expect(isPending(set('accepted', 'discarded'))).toBe(false);
  });

  it('is the whole thing for a draft', () => {
    const draft = {
      base_hash: 'h',
      proposed_body: 'x',
      kind: 'write',
      mode: 'replace',
      text: 'x',
    } as const;
    expect(isPending({ ...draft, outcome: null })).toBe(true);
    expect(isPending({ ...draft, outcome: 'accepted' })).toBe(false);
  });
});

describe('liveFixes', () => {
  it('keeps the unreviewed fixes and remembers where each sits in the set', () => {
    expect(
      liveFixes([fix(0, 'accepted'), fix(1), fix(2, 'discarded'), fix(3)]).map((f) => f.index),
    ).toEqual([1, 3]);
  });

  it('carries the span, the prose and the reason, and nothing else', () => {
    expect(liveFixes([fix(1)])).toEqual([
      {
        index: 0,
        from: 10,
        to: 15,
        find: 'find1',
        replace: 'replace1',
        explanation: 'because 1',
        severity: null,
      },
    ]);
  });
});

describe('shiftFixes', () => {
  const live = (index: number, from: number, to: number): LiveFix => ({
    index,
    from,
    to,
    find: 'x',
    replace: 'y',
    explanation: '',
    severity: null,
  });

  it('moves the fixes after the accepted span by what the splice changed', () => {
    // 5 characters become 8: everything after 20 slides three to the right.
    const after = shiftFixes([live(0, 0, 5), live(1, 30, 35)], {
      from: 15,
      to: 20,
      insert: '12345678',
    });
    expect(after.map((f) => [f.from, f.to])).toEqual([
      [0, 5],
      [33, 38],
    ]);
  });

  it('pulls them back when the replacement is shorter', () => {
    const after = shiftFixes([live(0, 30, 35)], { from: 10, to: 20, insert: 'abc' });
    expect([after[0].from, after[0].to]).toEqual([23, 28]);
  });

  it('leaves a fix that begins exactly where the accepted one ended', () => {
    const after = shiftFixes([live(0, 20, 25)], { from: 10, to: 20, insert: '0123456789' });
    expect([after[0].from, after[0].to]).toEqual([20, 25]);
  });
});

describe('outcomeSummary', () => {
  it('counts what is left while the writer is still working through it', () => {
    expect(outcomeSummary([fix(0), fix(1)])).toBe('Awaiting review in the chapter');
    expect(outcomeSummary([fix(0, 'accepted'), fix(1), fix(2)])).toBe(
      '2 still awaiting review in the chapter',
    );
  });

  it('counts what happened once every fix is reviewed', () => {
    expect(outcomeSummary([fix(0, 'accepted'), fix(1, 'accepted'), fix(2, 'discarded')])).toBe(
      '2 kept · 1 discarded',
    );
    expect(outcomeSummary([fix(0, 'stale')])).toBe('1 not applied — the chapter changed first');
  });
});
