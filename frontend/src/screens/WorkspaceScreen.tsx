import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { generatePlan, updateDocument } from '../api/endpoints';
import type { DocumentDetail, ProposalOutcome, ScenePlan } from '../api/types';
import { ChapterToolbar } from '../components/ChapterToolbar';
import { chapterPanelId, chapterTabId, type ChapterView } from '../components/chapterView';
import { ChatPane } from '../components/ChatPane';
import { DocumentEditor } from '../components/DocumentEditor';
import { DocumentSidebar } from '../components/DocumentSidebar';
import { PlanView, type PlanUndo } from '../components/PlanView';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { useChat } from '../hooks/useChat';
import { useDocumentSaving } from '../hooks/useDocumentSaving';
import { useStoredFlag } from '../hooks/useStoredFlag';
import {
  documentKey,
  documentsKey,
  useApplyUsage,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useDocuments,
  useMe,
  useProject,
  useReorderDocuments,
  useSetModel,
} from '../hooks/queries';
import { proposalViewOf } from '../lib/proposalView';

const COLLAPSE_KEY = 'maya.sidebar.collapsed';
const CHAT_KEY = 'maya.chat.open';

/** What the Plan view's Draft from plan asks the chat; the agent reads the saved plan. */
const DRAFT_FROM_PLAN = 'Draft this chapter from the scene plan.';

export function WorkspaceScreen() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useStoredFlag(COLLAPSE_KEY, false);
  const [chatOpen, setChatOpen] = useStoredFlag(CHAT_KEY, true);
  const [chapterView, setView] = useState<ChapterView>('write');
  // Tagged with its document, because a regenerate can finish after the writer moved on.
  const [undoState, setUndoState] = useState<{
    id: string;
    plan: ScenePlan;
    reason: PlanUndo;
  } | null>(null);
  // Opening a document, or coming back to one, starts on the prose with no undo
  // pending. Reset during render rather than in an effect, so the previous
  // document's view never paints over the new one.
  const [viewedDocId, setViewedDocId] = useState(documentId);
  if (viewedDocId !== documentId) {
    setViewedDocId(documentId);
    setView('write');
    setUndoState(null);
  }
  // Whether a chat proposal was on screen last render; see where it is compared.
  const [proposalShown, setProposalShown] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = useProject(projectId);
  const documents = useDocuments(projectId!);
  const document = useDocument(projectId!, documentId);
  const createDoc = useCreateDocument(projectId!);
  const deleteDoc = useDeleteDocument(projectId!);
  const reorderDocs = useReorderDocuments(projectId!);
  const me = useMe();
  const setModel = useSetModel();
  const applyUsage = useApplyUsage();
  const saving = useDocumentSaving(projectId!, documentId);
  const { save, settle } = saving;

  // With no document in the route, open the bible.
  useEffect(() => {
    if (!documentId && documents.data?.length) {
      const first = documents.data.find((d) => d.kind === 'bible') ?? documents.data[0];
      navigate(`/p/${projectId}/d/${first.id}`, { replace: true });
    }
  }, [documentId, documents.data, navigate, projectId]);

  const patchDocument = useCallback(
    (id: string, fields: Partial<DocumentDetail>) => {
      qc.setQueryData(documentKey(projectId!, id), (old?: DocumentDetail) =>
        old ? { ...old, ...fields } : old,
      );
    },
    [qc, projectId],
  );

  // Plan and review take the document id as their variable rather than reading
  // the route: a result that lands after the writer has switched documents
  // belongs to the document it was asked for, not the one now open.
  const planMut = useMutation({
    // The planner reads the saved chapter context. Plan edits save immediately
    // too, and a late one could otherwise land after the new plan and restore
    // the old one.
    mutationFn: (id: string) => settle().then(() => generatePlan(projectId!, id)),
    onMutate: () => setError(null),
    onSuccess: (res, id) => {
      patchDocument(id, { plan: res.plan });
      applyUsage(res.usage);
    },
    onError: (e: Error) => {
      setError(e.message);
      void me.refetch();
    },
  });

  const chat = useChat({
    projectId: projectId!,
    documentId,
    enabled: document.data?.kind === 'chapter',
    beforeSend: settle,
    onUsage: applyUsage,
    onFailure: () => void me.refetch(),
  });

  if (!projectId) return <Navigate to="/" replace />;
  if (project.isError) return <Navigate to="/" replace />;

  const doc = document.data;
  const isChapter = doc?.kind === 'chapter';
  const context = saving.contextFor(doc?.brief);

  /** Generate a plan, keeping the one it replaces so the writer can undo. */
  const generatePlanFor = () => {
    const id = documentId!;
    const previous = doc?.plan ?? null;
    setUndoState(null);
    planMut.mutate(id, {
      onSuccess: () => {
        if (previous) setUndoState({ id, plan: previous, reason: 'regenerated' });
      },
    });
  };

  const setPlan = (plan: ScenePlan | null) => {
    patchDocument(documentId!, { plan });
    void save({ plan });
  };

  const toggleChat = () => setChatOpen((open) => !open);

  const draftFromPlan = () => {
    setUndoState(null);
    setView('write'); // the draft streams into the editor and is reviewed there
    setChatOpen(true);
    void chat.send(DRAFT_FROM_PLAN);
  };

  /** Run a specialist pass over the chapter. Its fixes are reviewed in the
   *  prose, so the Write view comes forward with them. */
  const runAgent = (key: string) => {
    setView('write');
    setChatOpen(true);
    void chat.run(key);
  };

  // The server refuses generation once the budget is spent (402). Kept apart
  // from `busy`, which is transient in-flight state: being out of budget
  // disables only the affordances that would call the model.
  const aiBlocked = me.data?.usage.blocked ?? false;

  const pending = chat.pendingProposal;
  // While a proposal streams or waits for review, the editor is read-only and
  // every other generation waits: each would change the text it is drawn against.
  const proposal = proposalViewOf(chat.streaming, pending, chat.agents);
  // A proposal is reviewed in the editor, so when one appears the Write view
  // comes forward. Only on its arrival: the writer can still switch away.
  const proposalOnScreen = isChapter && proposal !== null;
  if (proposalOnScreen !== proposalShown) {
    setProposalShown(proposalOnScreen);
    if (proposalOnScreen) setView('write');
  }
  const view: ChapterView = isChapter ? chapterView : 'write';

  const chatBusy = chat.streaming !== null || pending !== null;
  const busy = planMut.isPending || deleteDoc.isPending || rewriteBusy || chatBusy;
  const planForThisDoc = planMut.variables === documentId;

  const chatDisabledReason = aiBlocked
    ? 'AI budget used — chat is paused.'
    : pending
      ? 'Accept or discard the suggestions in the chapter first.'
      : busy && chat.streaming === null
        ? 'Wait for the current AI action to finish.'
        : null;

  const resolveProposal = (outcome: ProposalOutcome, indexes?: number[]) => {
    if (pending) void chat.resolve(pending.messageId, outcome, indexes);
  };

  // Opening the Plan view calls no model: a chapter without a plan gets an empty
  // form, to fill in by hand or to generate on request.
  const changeView = (next: ChapterView) => {
    setView(next);
    if (next !== 'plan') setUndoState(null);
  };

  const tabPanel = (panel: ChapterView) =>
    isChapter
      ? { role: 'tabpanel', id: chapterPanelId(panel), 'aria-labelledby': chapterTabId(panel) }
      : {};

  return (
    <div className="flex h-screen flex-col bg-desk">
      <WorkspaceHeader
        projectName={project.data?.name}
        me={me.data}
        savingModel={setModel.isPending}
        onModelChange={(key) => setModel.mutate(key)}
      />

      <div className="relative flex flex-1 overflow-hidden">
        <DocumentSidebar
          documents={documents.data ?? []}
          loading={documents.isPending}
          activeId={documentId}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onSelect={(id) => {
            navigate(`/p/${projectId}/d/${id}`);
            // On a phone the open list covers the page; get it out of the way.
            if (window.matchMedia?.('(max-width: 767px)').matches) setCollapsed(true);
          }}
          onCreate={(kind) =>
            createDoc.mutate(
              { title: kind === 'note' ? 'Untitled note' : 'Untitled', kind },
              { onSuccess: (d) => navigate(`/p/${projectId}/d/${d.id}`) },
            )
          }
          onRename={(id, title) =>
            updateDocument(projectId, id, { title })
              .then(() => qc.invalidateQueries({ queryKey: documentsKey(projectId) }))
              .catch((e: Error) => setError(e.message))
          }
          onDelete={(id) =>
            deleteDoc.mutate(id, {
              onSuccess: () => {
                if (id === documentId) navigate(`/p/${projectId}`, { replace: true });
              },
              onError: (e: Error) => setError(e.message),
            })
          }
          onReorder={(ids) => reorderDocs.mutate(ids)}
        />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {isChapter && (
            <ChapterToolbar
              view={view}
              onViewChange={changeView}
              chatOpen={chatOpen}
              onToggleChat={toggleChat}
            />
          )}

          {doc ? (
            <>
              {/* Hidden rather than unmounted behind the Plan view, so the editor
                  keeps its undo history, scroll and selection. */}
              <div
                hidden={view !== 'write'}
                className="flex flex-1 flex-col overflow-hidden"
                {...tabPanel('write')}
              >
                <DocumentEditor
                  key={doc.id}
                  document={doc}
                  projectId={projectId}
                  readOnly={false}
                  onSave={save}
                  saveState={saving.saveState}
                  onBusyChange={setRewriteBusy}
                  aiBlocked={aiBlocked}
                  onUsage={applyUsage}
                  proposal={isChapter ? proposal : null}
                  onProposalResolve={resolveProposal}
                  flushRef={saving.editorFlush}
                  context={context}
                  onContextChange={saving.changeContext}
                />
              </div>

              {view === 'plan' && (
                <div className="flex flex-1 flex-col overflow-hidden" {...tabPanel('plan')}>
                  <PlanView
                    plan={doc.plan}
                    context={context}
                    onContextChange={saving.changeContext}
                    generating={planMut.isPending && planForThisDoc}
                    undo={undoState && undoState.id === documentId ? undoState.reason : null}
                    busy={busy}
                    aiBlocked={aiBlocked}
                    onChange={(plan) => {
                      setUndoState(null);
                      setPlan(plan);
                    }}
                    onGenerate={generatePlanFor}
                    onRemove={() => {
                      // Planning is optional: a stale or empty plan would otherwise
                      // keep steering every chat draft and review.
                      if (!doc.plan) return;
                      setUndoState({ id: documentId!, plan: doc.plan, reason: 'removed' });
                      setPlan(null);
                    }}
                    onUndo={() => {
                      if (!undoState) return;
                      setUndoState(null);
                      setPlan(undoState.plan);
                    }}
                    onGenerateDraft={draftFromPlan}
                  />
                </div>
              )}
            </>
          ) : documents.isLoading || document.isLoading ? (
            <div className="flex flex-1 justify-center px-10 pt-8" aria-busy="true">
              <div className="h-64 w-full max-w-[46rem] animate-pulse bg-paper/60 shadow-paper" />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center font-serif text-ink-3 italic">
              Choose a document from the list.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="absolute bottom-5 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 animate-rise items-center gap-3 rounded-xl border border-danger/30 bg-raised py-2 pr-2 pl-4 text-[13px] text-danger shadow-pop"
            >
              <span className="min-w-0">{error}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setError(null)}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-ink/6 hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        {isChapter && chatOpen && (
          <ChatPane
            messages={chat.messages}
            loading={chat.loading}
            streaming={chat.streaming}
            error={chat.error}
            disabledReason={chatDisabledReason}
            onSend={chat.send}
            agents={chat.agents}
            onRunAgent={runAgent}
            onClear={() => void chat.clear()}
            onClose={toggleChat}
          />
        )}
      </div>
    </div>
  );
}
