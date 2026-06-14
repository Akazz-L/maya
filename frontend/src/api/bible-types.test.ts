import { describe, expect, it } from 'vitest';
import { EMPTY_BIBLE, EMPTY_OUTLINE } from './bible-types';

describe('EMPTY_BIBLE', () => {
  it('has the expected shape', () => {
    expect(EMPTY_BIBLE.characters).toEqual([]);
    expect(EMPTY_BIBLE.world).toEqual({ locations: [], rules: [] });
    expect(EMPTY_BIBLE.style_guide).toEqual({ voice: '', avoid: [] });
    expect(EMPTY_BIBLE.timeline).toEqual([]);
  });
});

describe('EMPTY_OUTLINE', () => {
  it('has chapters array', () => {
    expect(EMPTY_OUTLINE.chapters).toEqual([]);
  });
});
