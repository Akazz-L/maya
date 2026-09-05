// State machine and stream orchestration for selection rewrite. The pure
// reducer is exported for tests; the hook drives the SSE request and owns
// the AbortController so discard and unmount can cancel it.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { rewriteStreamUrl } from '../api/endpoints';
import { streamPost } from '../api/stream';
import { matchEdgeWhitespace, type TextRange } from '../lib/rewrite';

export type RewritePhase = 'idle' | 'prompting' | 'streaming' | 'reviewing';

export interface RewriteState {
  phase: RewritePhase;
  range: TextRange | null;
  /** The selected text at open time; the whitespace template for the reply. */
  original: string;
  instruction: string;
  replacement: string;
  error: string | null;
}

export const initialRewriteState: RewriteState = {
  phase: 'idle',
  range: null,
  original: '',
  instruction: '',
  replacement: '',
  error: null,
};

export type RewriteAction =
  | { type: 'open'; range: TextRange; original: string }
  | { type: 'submit'; instruction: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }
  | { type: 'retry' }
  | { type: 'cancel' };

export function rewriteReducer(state: RewriteState, action: RewriteAction): RewriteState {
  switch (action.type) {
    case 'open':
      return { ...initialRewriteState, phase: 'prompting', range: action.range, original: action.original };
    case 'submit':
      return { ...state, phase: 'streaming', instruction: action.instruction, replacement: '', error: null };
    case 'delta':
      if (state.phase !== 'streaming') return state;
      return { ...state, replacement: state.replacement + action.text };
    case 'done': {
      if (state.phase !== 'streaming') return state;
      if (!action.text.trim()) {
        return { ...state, phase: 'reviewing', replacement: '', error: 'The model returned an empty rewrite.' };
      }
      return {
        ...state,
        phase: 'reviewing',
        replacement: matchEdgeWhitespace(state.original, action.text),
        error: null,
      };
    }
    case 'error':
      if (state.phase !== 'streaming') return state;
      return { ...state, phase: 'reviewing', replacement: '', error: action.message };
    case 'retry':
      return { ...state, phase: 'prompting', replacement: '', error: null };
    case 'cancel':
      return initialRewriteState;
  }
}

export interface RewriteContext {
  selection: string;
  before: string;
  after: string;
}

export function useSelectionRewrite({
  projectId,
  documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const [state, dispatch] = useReducer(rewriteReducer, initialRewriteState);
  const abortRef = useRef<AbortController | null>(null);

  const open = useCallback(
    (range: TextRange, original: string) => dispatch({ type: 'open', range, original }),
    [],
  );
  const retry = useCallback(() => dispatch({ type: 'retry' }), []);
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'cancel' });
  }, []);

  const submit = useCallback(
    async (instruction: string, context: RewriteContext) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: 'submit', instruction });
      try {
        await streamPost(
          rewriteStreamUrl(projectId, documentId),
          { instruction, ...context },
          {
            onDelta: (text) => dispatch({ type: 'delta', text }),
            onDone: (text) => dispatch({ type: 'done', text }),
          },
          controller.signal,
        );
      } catch (e) {
        if (!controller.signal.aborted) dispatch({ type: 'error', message: (e as Error).message });
      }
    },
    [projectId, documentId],
  );

  // A rewrite must not outlive its editor: switching documents or a finished
  // generation remounts the editor, and the request goes with it.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, open, submit, retry, cancel };
}
