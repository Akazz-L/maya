import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Menu as MenuIcon } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { updateDocument } from '../api/endpoints';
import type { ProposalOutcome } from '../api/types';
import { AppHeader } from '../components/AppHeader';
import { ChapterToolbar } from '../components/ChapterToolbar';
import { chapterPanelId, chapterTabId, type ChapterView } from '../components/chapterView';
import { ChatPane } from '../components/ChatPane';
import { DocumentEditor } from '../components/DocumentEditor';
import { DocumentSidebar } from '../components/DocumentSidebar';
import { ModelPicker } from '../components/ModelPicker';
import { PlanView } from '../components/PlanView';
import { SummarySources } from '../components/SummarySources';
import { StorySoFar } from '../components/StorySoFar';
import { SummaryView } from '../components/SummaryView';
import { UsageMeter } from '../components/UsageMeter';
import { Button } from '../components/ui/button';
import { EmptyState, InlineAlert, Skeleton } from '../components/ui/feedback';
import { useChapterPlan } from '../hooks/useChapterPlan';
import { useChapterSummary } from '../hooks/useChapterSummary';
import { useChat } from '../hooks/useChat';
import { useDocumentSaving } from '../hooks/useDocumentSaving';
import { useFocusReturn } from '../hooks/useFocusReturn';
import { CHAT_DOCKS, SIDEBAR_DOCKS, useMediaQuery } from '../hooks/useMediaQuery';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import {
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
import { toProposalView } from '../lib/proposalView';
import { cn } from '../lib/utils';

const COLLAPSE_KEY = 'maya.sidebar.collapsed';
const CHAT_KEY = 'maya.chat.open';

/** What the Plan view's Draft from plan asks the chat; the agent reads the saved plan. */
const DRAFT_FROM_PLAN = 'Draft this chapter from the scene plan.';

/** The page's shape while the open document loads. */
function EditorSkeleton() {
  return (
    <div role="status" aria-label="Loading document" className="flex-1 bg-surface">
      <div className="mx-auto flex max-w-page flex-col gap-3 px-6 pt-8">
        <Skeleton className="mb-4 h-8 w-2/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

export function WorkspaceScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return <Navigate to="/" replace />;
  // Keyed, so nothing held for one project (an undo, a draft) leaks into the next.
  return <Workspace key={projectId} projectId={projectId} />;
}

function Workspace({ projectId }: { projectId: string }) {
  const { documentId } = useParams<{ documentId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Beside the page on a wide screen; over it, on demand, on a narrow one.
  const sidebarDocked = useMediaQuery(SIDEBAR_DOCKS, true);
  const chatDocked = useMediaQuery(CHAT_DOCKS, true);
  const [collapsed, setCollapsed] = usePersistentFlag(COLLAPSE_KEY, false);
  const [chatPref, setChatPref] = usePersistentFlag(CHAT_KEY, true);
  const [navOpen, setNavOpen] = useState(false);
  // The chat as a sheet over the page starts closed each visit: on a phone it
  // would otherwise cover the chapter every time one is opened.
  const [chatSheetOpen, setChatSheetOpen] = useState(false);
  const chatOpen = chatDocked ? chatPref : chatSheetOpen;
  const drawerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const [chapterView, setView] = useState<ChapterView>('write');
  // The view to open the next chapter on, set when a summary is opened from
  // another chapter's Write view. State, not a ref: it is read while rendering
  // the document it belongs to.
  const [pendingView, setPendingView] = useState<ChapterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  // Whether a chat proposal was on screen last render; see where it is compared.
  const [proposalShown, setProposalShown] = useState(false);

  const project = useProject(projectId);
  const documents = useDocuments(projectId);
  const document = useDocument(projectId, documentId);
  const createDoc = useCreateDocument(projectId);
  const deleteDoc = useDeleteDocument(projectId);
  const reorderDocs = useReorderDocuments(projectId);
  const me = useMe();
  const setModel = useSetModel();
  const applyUsage = useApplyUsage();

  const doc = document.data;
  const isChapter = doc?.kind === 'chapter';

  const saving = useDocumentSaving(
    projectId,
    documentId,
    doc?.brief ?? '',
    doc?.summary ?? '',
    doc?.digest ?? '',
  );
  const plan = useChapterPlan({
    projectId,
    documentId,
    plan: doc?.plan ?? null,
    settle: saving.settle,
    save: saving.save,
    onUsage: applyUsage,
    onError: (message) => {
      setError(message);
      if (message) void me.refetch();
    },
  });
  const summary = useChapterSummary({
    projectId,
    documentId,
    enabled: isChapter,
    settle: saving.settle,
    resetEdit: saving.resetSummary,
    resetDigestEdit: saving.resetDigest,
    onUsage: applyUsage,
    onError: (message) => {
      setError(message);
      if (message) void me.refetch();
    },
  });
  const chat = useChat({
    projectId,
    documentId,
    enabled: isChapter,
    beforeSend: saving.settle,
    onUsage: applyUsage,
    onFailure: () => void me.refetch(),
  });

  const drawerOpen = !sidebarDocked && navOpen;
  const sheetOpen = isChapter && !chatDocked && chatSheetOpen;
  useFocusReturn(drawerOpen, drawerRef);
  useFocusReturn(sheetOpen, sheetRef);

  // Opening a document, or coming back to one, starts on the prose with no undo
  // pending. Reset during render rather than in an effect, so the previous
  // document's view never paints over the new one.
  const [viewedDocId, setViewedDocId] = useState(documentId);
  if (viewedDocId !== documentId) {
    setViewedDocId(documentId);
    // Unless the writer asked for another chapter's summary, in which case that
    // is the view they asked to land on.
    setView(pendingView ?? 'write');
    setPendingView(null);
    plan.clearUndo();
  }

  // With no document in the route, open the bible.
  useEffect(() => {
    if (!documentId && documents.data?.length) {
      const first = documents.data.find((d) => d.kind === 'bible') ?? documents.data[0];
      navigate(`/p/${projectId}/d/${first.id}`, { replace: true });
    }
  }, [documentId, documents.data, navigate, projectId]);

  const openChat = () => {
    // On a narrow screen the chat would cover the chapter the work streams into.
    if (chatDocked) setChatPref(true);
  };
  const toggleChat = () => (chatDocked ? setChatPref(!chatPref) : setChatSheetOpen((o) => !o));

  const draftFromPlan = () => {
    plan.clearUndo();
    setView('write'); // the draft streams into the editor and is reviewed there
    openChat();
    void chat.send(DRAFT_FROM_PLAN);
  };

  /** Run a specialist pass over the chapter. Its fixes are reviewed in the
   *  prose, so the Write view comes forward with them. */
  const runAgent = (key: string) => {
    setView('write');
    openChat();
    void chat.run(key);
  };

  // Opening the Plan view calls no model: a chapter without a plan gets an empty
  // form, to fill in by hand or to generate on request.
  const changeView = (next: ChapterView) => {
    setView(next);
    if (next !== 'plan') plan.clearUndo();
  };

  /** Open one chapter's summary — this chapter's, or a preceding one's. */
  const openSummary = (id: string) => {
    if (id === documentId) {
      setView('summary');
      return;
    }
    setPendingView('summary');
    selectDocument(id);
  };

  const selectDocument = (id: string) => {
    setNavOpen(false);
    navigate(`/p/${projectId}/d/${id}`);
  };

  if (project.isError) return <Navigate to="/" replace />;

  // The server refuses generation once the budget is spent (402). Kept apart
  // from `busy`, which is transient in-flight state: being out of budget
  // disables only the affordances that would call the model.
  const aiBlocked = me.data?.usage.blocked ?? false;

  const pending = chat.pendingProposal;
  // While a proposal streams or waits for review, the editor is read-only and
  // every other generation waits: each would change the text it is drawn against.
  const proposal = toProposalView(chat.streaming, pending, chat.agents);
  // A proposal is reviewed in the editor, so when one appears the Write view
  // comes forward. Only on its arrival: the writer can still switch away.
  const proposalOnScreen = isChapter && proposal !== null;
  if (proposalOnScreen !== proposalShown) {
    setProposalShown(proposalOnScreen);
    if (proposalOnScreen) setView('write');
  }
  const view: ChapterView = isChapter ? chapterView : 'write';

  const chatBusy = chat.streaming !== null || pending !== null;
  const busy = plan.pending || deleteDoc.isPending || rewriteBusy || chatBusy;

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

  const tabPanel = (panel: ChapterView) =>
    isChapter
      ? { role: 'tabpanel', id: chapterPanelId(panel), 'aria-labelledby': chapterTabId(panel) }
      : {};

  // A drawer or sheet over the page: the page behind it is out of reach until it closes.
  const pageInert = drawerOpen || sheetOpen;

  // Escape closes the panel it was pressed in, and goes no further: over a
  // proposal under review it must not also discard the proposal.
  const closeOnEscape = (close: () => void) => (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        leading={
          !sidebarDocked && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open documents"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <MenuIcon aria-hidden />
            </Button>
          )
        }
        title={project.data?.name ?? <Skeleton className="h-4 w-32" />}
      >
        {me.data && (
          <>
            <ModelPicker
              models={me.data.models}
              value={me.data.model_key}
              saving={setModel.isPending}
              onChange={(key) => setModel.mutate(key)}
            />
            <UsageMeter usage={me.data.usage} />
          </>
        )}
      </AppHeader>

      <div className="relative flex min-h-0 flex-1">
        {(drawerOpen || sheetOpen) && (
          <div
            aria-hidden
            onClick={() => (drawerOpen ? setNavOpen(false) : setChatSheetOpen(false))}
            className="fixed inset-0 z-drawer bg-ink/40 animate-fade"
          />
        )}

        <div
          className={cn(
            sidebarDocked
              ? 'flex'
              : 'fixed inset-y-0 left-0 z-drawer flex shadow-overlay transition-transform duration-200 ease-out',
            !sidebarDocked && !navOpen && '-translate-x-full shadow-none',
          )}
          // Off-screen, it must be out of the tab order and the accessibility tree.
          ref={drawerRef}
          inert={!sidebarDocked && !navOpen}
          onKeyDown={drawerOpen ? closeOnEscape(() => setNavOpen(false)) : undefined}
        >
          <DocumentSidebar
            documents={documents.data ?? []}
            activeId={documentId}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(!collapsed)}
            onClose={sidebarDocked ? undefined : () => setNavOpen(false)}
            onSelect={selectDocument}
            onCreate={(kind) =>
              createDoc.mutate(
                { title: kind === 'note' ? 'Untitled note' : 'Untitled', kind },
                { onSuccess: (d) => selectDocument(d.id) },
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
        </div>

        <main inert={pageInert} className="flex min-w-0 flex-1 flex-col">
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
              {/* Hidden rather than unmounted behind the Plan view, so the
                  editor keeps its undo history, scroll and selection. */}
              <div
                hidden={view !== 'write'}
                className="flex min-h-0 flex-1 flex-col"
                {...tabPanel('write')}
              >
                <DocumentEditor
                  key={doc.id}
                  document={doc}
                  projectId={projectId}
                  onSave={saving.save}
                  saveState={saving.saveState}
                  onBusyChange={setRewriteBusy}
                  aiBlocked={aiBlocked}
                  onUsage={applyUsage}
                  proposal={isChapter ? proposal : null}
                  onProposalResolve={resolveProposal}
                  flushRef={saving.editorFlush}
                  context={saving.context}
                  onContextChange={saving.changeContext}
                  contextNote={
                    isChapter ? (
                      <SummarySources
                        context={summary.context}
                        onOpen={openSummary}
                        onOpenStory={() => setView('summary')}
                      />
                    ) : null
                  }
                />
              </div>

              {view === 'summary' && (
                <div className="flex min-h-0 flex-1 flex-col" {...tabPanel('summary')}>
                  <SummaryView
                    summary={saving.summary}
                    status={doc.summary_status}
                    generating={summary.generating}
                    busy={busy}
                    aiBlocked={aiBlocked}
                    onChange={saving.changeSummary}
                    onGenerate={summary.generate}
                  >
                    <StorySoFar
                      digest={saving.digest}
                      status={summary.digestStatus}
                      covers={summary.digestCovers}
                      generating={summary.digestGenerating}
                      busy={busy}
                      aiBlocked={aiBlocked}
                      onChange={saving.changeDigest}
                      onGenerate={summary.generateDigest}
                    />
                  </SummaryView>
                </div>
              )}

              {view === 'plan' && (
                <div className="flex min-h-0 flex-1 flex-col" {...tabPanel('plan')}>
                  <PlanView
                    plan={doc.plan}
                    context={saving.context}
                    onContextChange={saving.changeContext}
                    generating={plan.generating}
                    undo={plan.undoReason}
                    busy={busy}
                    aiBlocked={aiBlocked}
                    onChange={plan.edit}
                    onGenerate={plan.generate}
                    onRemove={plan.remove}
                    onUndo={plan.undo}
                    onGenerateDraft={draftFromPlan}
                  />
                </div>
              )}
            </>
          ) : documents.isLoading || document.isLoading ? (
            <EditorSkeleton />
          ) : document.isError ? (
            <EmptyState title="This document couldn't be opened" className="my-auto">
              {document.error.message}
            </EmptyState>
          ) : (
            <EmptyState title="Select a document" className="my-auto">
              Choose one from the list, or start a new chapter.
            </EmptyState>
          )}

          {error && (
            <InlineAlert className="border-t" onDismiss={() => setError(null)}>
              {error}
            </InlineAlert>
          )}
        </main>

        {isChapter && chatOpen && (
          <div
            ref={sheetRef}
            className="contents"
            onKeyDown={sheetOpen ? closeOnEscape(() => setChatSheetOpen(false)) : undefined}
          >
            <ChatPane
              className={
                chatDocked
                  ? 'w-[22rem] shrink-0 xl:w-[24rem]'
                  : 'fixed inset-y-0 right-0 z-drawer w-full max-w-md shadow-overlay animate-pop'
              }
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
          </div>
        )}
      </div>
    </div>
  );
}
