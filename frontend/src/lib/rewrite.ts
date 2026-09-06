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

/**
 * Drop any part of the reply that merely repeats the context around the
 * selection. The prompt forbids it, but a model that starts a line early or
 * runs a sentence long would otherwise duplicate prose on accept. Only
 * overlaps of at least `minChars` count, so a shared word or two survives.
 * The reply is never emptied: an overlap that would consume it all is kept.
 */
export function stripContextEcho(
  replacement: string,
  before: string,
  after: string,
  minChars = 24,
): string {
  let out = replacement;

  const lead = before.trimEnd();
  for (let len = Math.min(lead.length, out.length - 1); len >= minChars; len--) {
    if (out.startsWith(lead.slice(lead.length - len))) {
      out = out.slice(len).trimStart();
      break;
    }
  }

  const trail = after.trimStart();
  for (let len = Math.min(trail.length, out.length - 1); len >= minChars; len--) {
    if (out.endsWith(trail.slice(0, len))) {
      out = out.slice(0, out.length - len).trimEnd();
      break;
    }
  }

  return out;
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
