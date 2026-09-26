import { describe, expect, it } from 'vitest';
import { contextWindows, matchEdgeWhitespace, stripContextEcho, wordDiff } from './rewrite';

describe('wordDiff on texts that differ almost everywhere', () => {
  it('gives up on a word-by-word diff and shows the passage replaced', () => {
    // A new draft of a long chapter against the old one. The two share common
    // words in different orders, which is the expensive case: uncapped, the
    // diff takes about a second and yields thousands of fragments.
    const vocabulary =
      'the a she he it was of and to in on at by with her his rain door hall light'.split(' ');
    const prose = (seed: number) => {
      let x = seed;
      return Array.from({ length: 5000 }, () => {
        x = (x * 1103515245 + 12345) % 2147483648;
        return vocabulary[x % vocabulary.length];
      }).join(' ');
    };
    const oldText = prose(1);
    const newText = prose(2);
    expect(wordDiff(oldText, newText)).toEqual([
      { value: oldText, added: false, removed: true },
      { value: newText, added: true, removed: false },
    ]);
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

describe('stripContextEcho', () => {
  const before = 'The hall was empty, and had been empty for hours. ';
  const after = ' A clock ticked somewhere in the dark house.';

  it('removes a trailing echo of the after-context', () => {
    const reply = 'She froze by the door. A clock ticked somewhere in the dark house.';
    expect(stripContextEcho(reply, before, after)).toBe('She froze by the door.');
  });

  it('removes a leading echo of the before-context', () => {
    const reply = 'The hall was empty, and had been empty for hours. She froze by the door.';
    expect(stripContextEcho(reply, before, after)).toBe('She froze by the door.');
  });

  it('removes a partial echo, as long as it is longer than the threshold', () => {
    const reply = 'She froze by the door. A clock ticked somewhere in';
    expect(stripContextEcho(reply, before, after)).toBe('She froze by the door.');
  });

  it('ignores short overlaps that are just shared words', () => {
    const reply = 'She froze by the door. A clock';
    expect(stripContextEcho(reply, before, after)).toBe('She froze by the door. A clock');
  });

  it('leaves a reply with no echo alone', () => {
    expect(stripContextEcho('She froze.', before, after)).toBe('She froze.');
  });

  it('never strips the whole reply', () => {
    expect(stripContextEcho(after.trim(), '', after)).toBe(after.trim());
  });

  it('keeps a reply a strip would reduce to whitespace', () => {
    // The length guard leaves a character behind, but that character can be a
    // space; an all-whitespace result would surface as "empty rewrite".
    const reply = ` ${after.trimStart().slice(0, 30)}`;
    expect(stripContextEcho(reply, before, after)).toBe(reply);
  });
});

describe('wordDiff', () => {
  it('marks removed and added words', () => {
    const parts = wordDiff('She waited by the door.', 'She froze by the door.');
    expect(parts.find((p) => p.removed)?.value).toBe('waited');
    expect(parts.find((p) => p.added)?.value).toBe('froze');
    expect(parts.every((p) => typeof p.added === 'boolean' && typeof p.removed === 'boolean')).toBe(
      true,
    );
  });
});
