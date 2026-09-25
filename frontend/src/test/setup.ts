import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetClerk } from './clerk';

vi.mock('@clerk/react', async () => (await import('./clerk')).clerkModule);

// jsdom has no layout engine, so Range is missing getClientRects. CodeMirror
// calls it to map a document position to screen coordinates; an empty list is
// the "no layout yet" answer it already understands (coordsAtPos returns null),
// where a missing method is a TypeError.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  const empty = Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = () => empty;
}

// jsdom implements <dialog> but not its modal methods. Opening sets `open`,
// which is all a test can observe; focus trapping is the browser's job.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetClerk();
});
