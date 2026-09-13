import { describe, expect, it } from 'vitest';
import type { ChatProposal } from '../api/types';
import { changedSpan, describeProposal, outcomeLabel, sha256Hex, streamingBody } from './chat';

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
    const one: ChatProposal = { ...base, kind: 'edit', edits: [{ find: 'a', replace: 'b' }] };
    const two: ChatProposal = { ...one, edits: [...one.edits, { find: 'c', replace: 'd' }] };
    expect(describeProposal(draft)).toBe('New draft · 3 words');
    expect(describeProposal(more)).toBe('Continuation · 2 words');
    expect(describeProposal(one)).toBe('1 edit');
    expect(describeProposal(two)).toBe('2 edits');
  });

  it('says what became of it', () => {
    expect(outcomeLabel(null)).toBe('Awaiting review in the editor');
    expect(outcomeLabel('accepted')).toBe('Accepted');
    expect(outcomeLabel('discarded')).toBe('Discarded');
    expect(outcomeLabel('stale')).toBe('Not applied — the chapter changed first');
  });
});
