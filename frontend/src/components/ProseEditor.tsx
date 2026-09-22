// A CodeMirror 6 view dressed as a page of prose. Plain text in, plain text
// out: the document stays a string with newlines, which is what the backend
// agents read. Extensions (like the chapter rewrite overlay) are injected by
// the parent; this component knows nothing about them.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

export interface ProseEditorProps {
  value: string;
  onChange: (text: string) => void;
  readOnly: boolean;
  ariaLabel: string;
  placeholder?: string;
  /** Extra CodeMirror extensions. Captured when the view is created; later changes are ignored. */
  extensions?: Extension[];
  /** Called once, after the view exists, so a sibling can drive it. */
  onViewReady?: (view: EditorView) => void;
  /** Rendered inside the editor's relative wrapper, above the text. */
  children?: ReactNode;
}

/** Marks transactions that mirror the `value` prop, so they don't echo back through onChange. */
const external = Annotation.define<boolean>();

/**
 * The prose is a sheet of paper on the desk: a centred column of measured
 * width, in the manuscript face. Sizes come from CSS variables the parent sets
 * per breakpoint, so the sheet lines up with the title block above it and
 * narrows on a phone. The top edge is clipped out of the shadow because the
 * title block is the top of the same sheet.
 */
const proseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '17px', backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-scroller': {
    fontFamily: 'var(--font-serif)',
    lineHeight: '1.85',
    padding: '0 var(--sheet-gutter, 0px)',
    scrollbarGutter: 'stable both-edges',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 'var(--sheet-width, 46rem)',
    margin: '0 auto',
    padding: '12px var(--sheet-pad-x, 24px) 40vh',
    backgroundColor: 'var(--paper)',
    boxShadow: 'var(--shadow-paper)',
    clipPath: 'inset(0 -64px -64px -64px)',
    caretColor: 'var(--accent)',
    transition: 'opacity 200ms ease',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--ink-3)', fontStyle: 'italic' },
});

const readOnlyConfig = (readOnly: boolean): Extension => [
  EditorView.editable.of(!readOnly),
  EditorState.readOnly.of(readOnly),
];

export function ProseEditor({
  value,
  onChange,
  readOnly,
  ariaLabel,
  placeholder,
  extensions = [],
  onViewReady,
  children,
}: ProseEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Lazy state, not a ref: the compartment belongs to the view for its whole
  // life and is never reassigned, and this way it is built once.
  const [readOnlyComp] = useState(() => new Compartment());
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Create the view once. Props that can change later (value, readOnly) are
  // synced by the effects below; everything else is fixed for the view's life.
  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          proseTheme,
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            spellcheck: 'true',
            autocorrect: 'on',
          }),
          placeholder ? cmPlaceholder(placeholder) : [],
          readOnlyComp.of(readOnlyConfig(readOnly)),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (u.transactions.some((t) => t.annotation(external))) return;
            onChangeRef.current(u.state.doc.toString());
          }),
          ...extensions,
        ],
      }),
      parent: host.current!,
    });
    viewRef.current = view;
    onViewReady?.(view);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: external.of(true),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.reconfigure(readOnlyConfig(readOnly)),
    });
  }, [readOnly, readOnlyComp]);

  return (
    <div className="relative min-h-0 flex-1" data-readonly={readOnly || undefined}>
      <div ref={host} className="h-full" />
      {children}
    </div>
  );
}
