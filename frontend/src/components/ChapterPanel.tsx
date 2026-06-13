import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  acceptChapter,
  checkDraft,
  draftStreamUrl,
  generatePlan,
  getChapter,
  getDraftState,
  reviseStreamUrl,
} from '../api/endpoints';
import type { DraftState, SavedChapter, ScenePlan } from '../api/types';
import { useDraftStream } from '../hooks/useDraftStream';
import {
  initialState,
  planHasContent,
  workflowReducer,
} from '../hooks/workflowReducer';
import { ActionRow } from './ActionRow';
import { ChapterControls } from './ChapterControls';
import { DraftEditor } from './DraftEditor';
import { IssuesList } from './IssuesList';
import { PlanForm } from './PlanForm';
import { SavedView } from './SavedView';
import { StepBar } from './StepBar';

interface Status {
  text: string;
  isError: boolean;
}
const NO_STATUS: Status = { text: '', isError: false };

/** Trim fields and drop empty beats before sending a plan to the server. */
function cleanPlan(plan: ScenePlan): ScenePlan {
  return {
    goal: plan.goal.trim(),
    pov_character: plan.pov_character.trim(),
    location: plan.location.trim(),
    sensory_anchor: plan.sensory_anchor.trim(),
    opening_image: plan.opening_image.trim(),
    closing_image: plan.closing_image.trim(),
    beats: plan.beats.map((b) => b.trim()).filter(Boolean),
  };
}

export function ChapterPanel({ projectId }: { projectId: string }) {
  const [chapter, setChapter] = useState(1);
  const [state, dispatch] = useReducer(workflowReducer, initialState);
  const [status, setStatus] = useState<Status>(NO_STATUS);
  const stream = useDraftStream();

  // Guards against stale async loads when the chapter changes mid-request.
  const loadIdRef = useRef(0);

  const loadView = useCallback(async () => {
    const myId = ++loadIdRef.current;
    dispatch({ type: 'reset' });
    setStatus(NO_STATUS);
    let chapterData: SavedChapter | null = null;
    let stateData: DraftState | null = null;
    try {
      chapterData = await getChapter(projectId, chapter);
    } catch {
      /* no saved chapter */
    }
    try {
      stateData = await getDraftState(projectId, chapter);
    } catch {
      /* no in-progress workflow */
    }
    if (loadIdRef.current !== myId) return; // a newer load superseded this one
    const overwrite = Boolean(chapterData);
    if (stateData) dispatch({ type: 'resume', draftState: stateData, overwrite });
    else if (chapterData) dispatch({ type: 'showSaved', chapter: chapterData });
  }, [projectId, chapter]);

  useEffect(() => {
    // Loading a chapter from the server on mount / chapter change is a genuine
    // external-system sync; the synchronous reset inside is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadView();
  }, [loadView]);

  // ── non-streaming actions (TanStack mutations) ────────────────────────────
  const planMut = useMutation({
    mutationFn: () => generatePlan(projectId, chapter),
    onSuccess: (res) => {
      dispatch({ type: 'planGenerated', plan: res.scene_plan });
      setStatus({ text: 'Plan generated. Edit fields then continue.', isError: false });
    },
    onError: (e: Error) => setStatus({ text: e.message, isError: true }),
  });

  const checkMut = useMutation({
    mutationFn: () => checkDraft(projectId, chapter, state.draft),
    onSuccess: (res) => {
      dispatch({ type: 'issuesChecked', issues: res.issues });
      const n = res.issues.length;
      setStatus({
        text: n
          ? `${n} issue${n > 1 ? 's' : ''} found. Edit, remove, or revise.`
          : 'No issues — ready to accept.',
        isError: false,
      });
    },
    onError: (e: Error) => setStatus({ text: e.message, isError: true }),
  });

  const acceptMut = useMutation({
    mutationFn: () =>
      acceptChapter(
        projectId,
        chapter,
        { scene_plan: state.plan, draft: state.draft, issues: state.issues },
        state.overwrite,
      ),
    onSuccess: async () => {
      await loadView(); // re-render as the now-locked saved chapter
      setStatus({ text: `Chapter ${chapter} saved.`, isError: false });
    },
    onError: (e: Error) => setStatus({ text: e.message, isError: true }),
  });

  // ── streaming actions ─────────────────────────────────────────────────────
  const generateDraft = async () => {
    const cleaned = cleanPlan(state.plan);
    dispatch({ type: 'setPlan', plan: cleaned });
    dispatch({ type: 'draftStarted' });
    try {
      await stream.run(
        draftStreamUrl(projectId, chapter),
        { scene_plan: cleaned },
        {
          onDelta: (text) => dispatch({ type: 'appendDraft', text }),
          onDone: (draft) => dispatch({ type: 'setDraft', draft }),
        },
      );
      setStatus({ text: 'Draft ready. Edit then check for issues.', isError: false });
    } catch (e) {
      setStatus({ text: (e as Error).message, isError: true });
    }
  };

  const reviseDraft = async () => {
    const prevDraft = state.draft;
    const issues = state.issues;
    dispatch({ type: 'draftStarted' });
    try {
      await stream.run(
        reviseStreamUrl(projectId, chapter),
        { draft: prevDraft, issues },
        {
          onDelta: (text) => dispatch({ type: 'appendDraft', text }),
          onDone: (draft) => dispatch({ type: 'setDraft', draft }),
        },
      );
      setStatus({ text: 'Revised draft ready. Check again or accept.', isError: false });
    } catch (e) {
      setStatus({ text: (e as Error).message, isError: true });
    }
  };

  const redo = () => {
    if (
      !window.confirm(
        `Redo chapter ${chapter}? The saved version will be replaced when you accept again.`,
      )
    )
      return;
    dispatch({ type: 'redo' });
    setStatus({
      text: 'Editing a saved chapter — re-accepting will replace it.',
      isError: false,
    });
  };

  const busy =
    planMut.isPending || checkMut.isPending || acceptMut.isPending || stream.isStreaming;

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      <StepBar step={state.step} />

      <ChapterControls chapter={chapter} onChange={setChapter} />

      <div className="flex-1 overflow-y-auto rounded-md border border-gray-200 bg-white p-5">
        {state.step === 'empty' && (
          <div className="flex h-52 flex-col items-center justify-center gap-2 text-sm text-gray-400">
            <p>Enter a chapter number and generate a plan to begin.</p>
          </div>
        )}
        {state.step === 'plan' && (
          <PlanForm plan={state.plan} onChange={(plan) => dispatch({ type: 'setPlan', plan })} />
        )}
        {state.step === 'draft' && (
          <DraftEditor
            value={state.draft}
            onChange={(draft) => dispatch({ type: 'setDraft', draft })}
            autoScroll={stream.isStreaming}
          />
        )}
        {state.step === 'check' && (
          <IssuesList
            issues={state.issues}
            onChange={(issues) => dispatch({ type: 'setIssues', issues })}
          />
        )}
        {state.step === 'saved' && <SavedView chapter={chapter} draft={state.draft} />}
      </div>

      <ActionRow
        step={state.step}
        planReady={planHasContent(state.plan)}
        busy={busy}
        status={status}
        onGeneratePlan={() => planMut.mutate()}
        onGenerateDraft={generateDraft}
        onBackToPlan={() => dispatch({ type: 'toPlan' })}
        onCheck={() => checkMut.mutate()}
        onRevise={reviseDraft}
        onAccept={() => acceptMut.mutate()}
        onRedo={redo}
      />
    </main>
  );
}
