// Drive a CodeMirror view in tests. jsdom cannot deliver real keystrokes
// through CodeMirror's DOM observer, so edits go through view.dispatch, which
// is the same path a keystroke takes once CodeMirror has interpreted it.
import { act, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

export function viewFor(label: string): EditorView {
  const view = EditorView.findFromDOM(screen.getByLabelText(label) as HTMLElement);
  if (!view) throw new Error(`No CodeMirror view behind "${label}"`);
  return view;
}

export function typeAtEnd(label: string, text: string): void {
  const view = viewFor(label);
  act(() => {
    view.dispatch({
      changes: { from: view.state.doc.length, insert: text },
      userEvent: 'input.type',
    });
  });
}

export function selectRange(label: string, from: number, to: number): void {
  const view = viewFor(label);
  act(() => {
    view.dispatch({ selection: { anchor: from, head: to } });
  });
}
