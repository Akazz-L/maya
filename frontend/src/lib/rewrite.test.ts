import { describe, expect, it } from 'vitest';
import { contextWindows, matchEdgeWhitespace, spliceText, wordDiff } from './rewrite';

describe('spliceText', () => {
  it('replaces only the range and keeps everything else byte-for-byte', () => {
    const text = 'The hall was empty. She waited by the door. A clock ticked.';
    const out = spliceText(text, { from: 20, to: 43 }, 'She froze.');
    expect(out).toBe('The hall was empty. She froze. A clock ticked.');
  });
});

describe('contextWindows', () => {
  it('splits text around the range', () => {
    const text = 'aaa SELECTED zzz';
    expect(contextWindows(text, { from: 4, to: 12 })).toEqual({
      before: 'aaa ',
      selection: 'SELECTED',
      after: ' zzz',
    });
  });

  it('bounds the windows', () => {
    const text = 'x'.repeat(2000) + 'SEL' + 'y'.repeat(2000);
    const w = contextWindows(text, { from: 2000, to: 2003 });
    expect(w.before).toHaveLength(1500);
    expect(w.after).toHaveLength(500);
    expect(w.selection).toBe('SEL');
  });
});

describe('matchEdgeWhitespace', () => {
  it('copies the original leading and trailing whitespace onto a trimmed reply', () => {
    expect(matchEdgeWhitespace('\n\nOld text.\n', '  New text.\n\n')).toBe('\n\nNew text.\n');
  });

  it('leaves a reply alone when the original has no edge whitespace', () => {
    expect(matchEdgeWhitespace('Old.', 'New.')).toBe('New.');
  });

  it('does not double whitespace when the original is only whitespace', () => {
    expect(matchEdgeWhitespace('  ', 'New.')).toBe('  New.');
  });
});

describe('wordDiff', () => {
  it('marks removed and added words', () => {
    const parts = wordDiff('She waited by the door.', 'She froze by the door.');
    expect(parts.find((p) => p.removed)?.value).toBe('waited');
    expect(parts.find((p) => p.added)?.value).toBe('froze');
    expect(parts.every((p) => typeof p.added === 'boolean' && typeof p.removed === 'boolean')).toBe(true);
  });
});
