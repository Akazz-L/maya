// Pure helpers for selection rewrite. No React, no network, no CodeMirror.
import { diffWords } from 'diff';

export interface TextRange {
  from: number;
  to: number;
}

/** Replace [from, to) with `replacement`; every other character is untouched. */
export function spliceText(text: string, { from, to }: TextRange, replacement: string): string {
  return text.slice(0, from) + replacement + text.slice(to);
}

/** Split text around the range, trimming the context to the given maxima. */
export function contextWindows(
  text: string,
  { from, to }: TextRange,
  beforeMax = 1500,
  afterMax = 500,
): { before: string; selection: string; after: string } {
  return {
    before: text.slice(Math.max(0, from - beforeMax), from),
    selection: text.slice(from, to),
    after: text.slice(to, to + afterMax),
  };
}

/**
 * Trim the model's reply, then give it the original selection's leading and
 * trailing whitespace, so a selection that ended in a paragraph break still
 * ends in one after the rewrite.
 */
export function matchEdgeWhitespace(original: string, replacement: string): string {
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original.slice(lead.length))![0];
  return lead + replacement.trim() + trail;
}

export interface DiffPart {
  value: string;
  added: boolean;
  removed: boolean;
}

/** Word-level diff of old → new, for inline review rendering. */
export function wordDiff(oldText: string, newText: string): DiffPart[] {
  return diffWords(oldText, newText).map((p) => ({
    value: p.value,
    added: Boolean(p.added),
    removed: Boolean(p.removed),
  }));
}
