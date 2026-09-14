import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  checkDocument,
  generatePlan,
  getProject,
  reviseStreamUrl,
  updateDocument,
  type DocumentPatch,
} from '../api/endpoints';
import {
  EMPTY_PLAN,
  type DocumentDetail,
  type Issue,
  type ProposalOutcome,
  type ScenePlan,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ChapterToolbar } from '../components/ChapterToolbar';
import { chapterPanelId, chapterTabId, type ChapterView } from '../components/chapterView';
import { ChatPane } from '../components/ChatPane';
import { ModelPicker } from '../components/ModelPicker';
import { UsageMeter } from '../components/UsageMeter';
import { DocumentEditor, type SaveState } from '../components/DocumentEditor';
import { DocumentSidebar } from '../components/DocumentSidebar';
import { IssuesView } from '../components/IssuesView';
import { PlanView, type PlanUndo } from '../components/PlanView';
import type { ProposalView } from '../components/ProposalLayer';
import { Button } from '../components/ui/button';
import { useChat } from '../hooks/useChat';
import { useDraftStream } from '../hooks/useDraftStream';
import {
  documentKey,
  documentsKey,
  useApplyUsage,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useDocuments,
  useMe,
  useReorderDocuments,
  useSetModel,
} from '../hooks/queries';

const COLLAPSE_KEY = 'maya.sidebar.collapsed';
const CHAT_KEY = 'maya.chat.open';

/** What the Plan view's Draft from plan asks the chat; the agent reads the saved plan. */
const DRAFT_FROM_PLAN = 'Draft this chapter from the scene plan.';

export function WorkspaceScreen() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId?: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem(CHAT_KEY) !== '0');
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
  // Bumped whenever the server rewrites the body, to remount the editor onto it.
  const [docVersion, setDocVersion] = useState(0);
  const [streamBody, setStreamBody] = useState<string | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Holds the in-flight autosave so a request that reads the document server-side
  // can wait for it to land. Without this the server works from a stale body
  // and the writer's last keystrokes vanish.
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  // Filled by the editor: saves an edit still waiting out the autosave debounce.
  const editorFlush = useRef<(() => void) | null>(null);
  // Filled by the editor: expands the chapter notes and focuses them.
  const notesFocus = useRef<(() => void) | null>(null);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });
  const documents = useDocuments(projectId!);
  const document = useDocument(projectId!, documentId);
  const createDoc = useCreateDocument(projectId!);
  const deleteDoc = useDeleteDocument(projectId!);
  const reorderDocs = useReorderDocuments(projectId!);
  const stream = useDraftStream();
  const me = useMe();
  const setModel = useSetModel();
  const applyUsage = useApplyUsage();

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
  const patchCache = useCallback(
    (fields: Partial<DocumentDetail>) => patchDocument(documentId!, fields),
    [patchDocument, documentId],
  );

  const save = useCallback(
    (patch: DocumentPatch) => {
      if (!documentId) return Promise.resolve();
      setSaveState('saving');
      const promise = updateDocument(projectId!, documentId, patch)
        .then((doc) => {
          qc.setQueryData(documentKey(projectId!, documentId), doc);
          if (patch.title !== undefined) {
            qc.invalidateQueries({ queryKey: documentsKey(projectId!) });
          }
          setSaveState('saved');
        })
        .catch(() => setSaveState('error'));
      pendingSave.current = promise;
      return promise;
    },
    [documentId, projectId, qc],
  );

  /**
   * Put everything the writer has typed on the server before a request reads it
   * there. Awaiting only the in-flight save is not enough: an edit still inside
   * the autosave debounce has not been sent at all.
   */
  const settle = useCallback(async () => {
    editorFlush.current?.();
    await pendingSave.current;
  }, []);

  // Plan and check take the document id as their variable rather than reading
  // the route: a result that lands after the writer has switched documents
  // belongs to the document it was asked for, not the one now open.
  const planMut = useMutation({
    // The planner reads the saved brief. Plan edits save immediately too, and a
    // late one could otherwise land after the new plan and restore the old one.
    mutationFn: (id: string) => settle().then(() => generatePlan(projectId!, id)),
    onMutate: () => setError(null),
    onSuccess: (res, id) => {
      patchDocument(id, { plan: res.plan });
      applyUsage(res.usage);
    },
    onError: (e: Error) => {
      setError(e.message);
      me.refetch();
    },
  });

  const checkMut = useMutation({
    // Check reads Document.body server-side.
    mutationFn: (id: string) => settle().then(() => checkDocument(projectId!, id)),
    onMutate: () => setError(null),
    onSuccess: (res, id) => {
      patchDocument(id, { issues: res.issues });
      applyUsage(res.usage);
      if (id === documentId) setView('issues');
    },
    onError: (e: Error) => {
      setError(e.message);
      me.refetch();
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

  /** Save pending edits, then stream; the server owns `body` for the duration. */
  const runStream = async (url: string, body: unknown) => {
    setError(null);
    await settle();
    setStreamBody(document.data?.body ?? '');
    try {
      await stream.run(url, body, {
        onDelta: (text) => setStreamBody((prev) => (prev ?? '') + text),
        onDone: (full, usage) => {
          patchCache({ body: full });
          applyUsage(usage);
          setStreamBody(undefined);
          setDocVersion((v) => v + 1); // remount the editor onto the server's body
        },
      });
    } catch (e) {
      setError((e as Error).message);
      setStreamBody(undefined);
      me.refetch();
    }
  };

  const revise = () => {
    setView('write');
    return runStream(reviseStreamUrl(projectId!, documentId!), null);
  };

  /** Generate a plan, keeping the one it replaces so the writer can undo. */
  const regeneratePlan = () => {
    const id = documentId!;
    const previous = document.data?.plan ?? null;
    setUndoState(null);
    planMut.mutate(id, {
      onSuccess: () => {
        if (previous) setUndoState({ id, plan: previous, reason: 'regenerated' });
      },
    });
  };

  const setPlan = (plan: ScenePlan | null) => {
    patchCache({ plan });
    save({ plan });
  };

  const openChat = () => {
    localStorage.setItem(CHAT_KEY, '1');
    setChatOpen(true);
  };

  const toggleChat = () =>
    setChatOpen((open) => {
      localStorage.setItem(CHAT_KEY, open ? '0' : '1');
      return !open;
    });

  const draftFromPlan = () => {
    setUndoState(null);
    setView('write'); // the draft streams into the editor and is reviewed there
    openChat();
    void chat.send(DRAFT_FROM_PLAN);
  };

  if (!projectId) return <Navigate to="/" replace />;
  if (project.isError) return <Navigate to="/" replace />;

  const doc = document.data;
  const isChapter = doc?.kind === 'chapter';
  // The server refuses generation once the budget is spent (402). Kept apart
  // from `busy`, which is transient in-flight state: being out of budget
  // disables only the affordances that would call the model.
  const aiBlocked = me.data?.usage.blocked ?? false;

  const pending = chat.pendingProposal;
  // While a proposal streams or waits for review, the editor is read-only and
  // every other generation waits: each would change the text it is drawn against.
  const proposal: ProposalView | null = chat.streaming?.progress
    ? { phase: 'streaming', mode: chat.streaming.progress.mode, text: chat.streaming.progress.text }
    : pending && pending.proposal.proposed_body !== null
      ? {
          phase: 'reviewing',
          proposed: pending.proposal.proposed_body,
          baseHash: pending.proposal.base_hash,
          // Edits read best as a diff; a new draft against the old one is noise.
          showDiff: pending.proposal.kind === 'edit',
        }
      : null;
  // A proposal is reviewed in the editor, so when one appears the Write view
  // comes forward. Only on its arrival: the writer can still switch away.
  const proposalOnScreen = isChapter && proposal !== null;
  if (proposalOnScreen !== proposalShown) {
    setProposalShown(proposalOnScreen);
    if (proposalOnScreen) setView('write');
  }
  const view: ChapterView = isChapter ? chapterView : 'write';

  const chatBusy = chat.streaming !== null || pending !== null;
  const busy =
    planMut.isPending ||
    checkMut.isPending ||
    stream.isStreaming ||
    deleteDoc.isPending ||
    rewriteBusy ||
    chatBusy;
  const planForThisDoc = planMut.variables === documentId;

  const chatDisabledReason = aiBlocked
    ? 'AI budget used — chat is paused.'
    : pending
      ? 'Accept or discard the proposal in the editor first.'
      : busy && chat.streaming === null
        ? 'Wait for the current AI action to finish.'
        : null;

  const resolveProposal = (outcome: ProposalOutcome) => {
    if (pending) void chat.resolve(pending.messageId, outcome);
  };

  const changeView = (next: ChapterView) => {
    setView(next);
    if (next !== 'plan') setUndoState(null);
    // Opening an empty plan generates one; opening a saved plan never calls the model.
    if (next === 'plan' && !doc?.plan && !busy && !aiBlocked) regeneratePlan();
  };

  const tabPanel = (panel: ChapterView) =>
    isChapter
      ? { role: 'tabpanel', id: chapterPanelId(panel), 'aria-labelledby': chapterTabId(panel) }
      : {};

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f0]">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            ← Projects
          </Button>
          <h1 className="text-base font-semibold text-gray-800">{project.data?.name ?? '…'}</h1>
        </div>
        <div className="flex items-center gap-4">
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
          <Button variant="secondary" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <DocumentSidebar
          documents={documents.data ?? []}
          activeId={documentId}
          collapsed={collapsed}
          onToggleCollapsed={() =>
            setCollapsed((c) => {
              localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
              return !c;
            })
          }
          onSelect={(id) => navigate(`/p/${projectId}/d/${id}`)}
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

        <div className="flex flex-1 flex-col overflow-hidden">
          {isChapter && (
            <ChapterToolbar
              view={view}
              onViewChange={changeView}
              issueCount={doc?.issues?.length ?? null}
              busy={busy}
              aiBlocked={aiBlocked}
              onCheck={() => checkMut.mutate(documentId!)}
              chatOpen={chatOpen}
              onToggleChat={toggleChat}
            />
          )}

          {doc ? (
            <>
              {/* Hidden rather than unmounted behind the Plan and Issues views, so the
                  editor keeps its undo history, scroll and selection. */}
              <div
                hidden={view !== 'write'}
                className="flex flex-1 flex-col overflow-hidden"
                {...tabPanel('write')}
              >
                <DocumentEditor
                  key={`${doc.id}:${docVersion}`}
                  document={doc}
                  projectId={projectId}
                  readOnly={stream.isStreaming}
                  onSave={save}
                  saveState={saveState}
                  bodyOverride={streamBody}
                  onBusyChange={setRewriteBusy}
                  aiBlocked={aiBlocked}
                  onUsage={applyUsage}
                  proposal={isChapter ? proposal : null}
                  onProposalResolve={resolveProposal}
                  flushRef={editorFlush}
                  notesFocusRef={notesFocus}
                />
              </div>

              {view === 'plan' && (
                <div className="flex flex-1 flex-col overflow-hidden" {...tabPanel('plan')}>
                  <PlanView
                    plan={doc.plan}
                    generating={planMut.isPending && planForThisDoc}
                    failed={planMut.isError && planForThisDoc}
                    undo={undoState && undoState.id === documentId ? undoState.reason : null}
                    busy={busy}
                    aiBlocked={aiBlocked}
                    onChange={(plan) => {
                      setUndoState(null);
                      setPlan(plan);
                    }}
                    onGenerate={regeneratePlan}
                    onRemove={() => {
                      // Planning is optional: a stale or empty plan would otherwise
                      // keep steering every chat draft and check.
                      if (!doc.plan) return;
                      setUndoState({ id: documentId!, plan: doc.plan, reason: 'removed' });
                      setPlan(null);
                    }}
                    onUndo={() => {
                      if (!undoState) return;
                      setUndoState(null);
                      setPlan(undoState.plan);
                    }}
                    onStartBlank={() => setPlan(EMPTY_PLAN)}
                    onGenerateDraft={draftFromPlan}
                  />
                </div>
              )}

              {view === 'issues' && (
                <div className="flex flex-1 flex-col overflow-hidden" {...tabPanel('issues')}>
                  <IssuesView
                    issues={doc.issues}
                    busy={busy}
                    aiBlocked={aiBlocked}
                    onChange={(issues: Issue[]) => {
                      patchCache({ issues });
                      save({ issues });
                    }}
                    onRevise={revise}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              {documents.isLoading || document.isLoading ? 'Loading…' : 'Select a document.'}
            </div>
          )}

          {error && (
            <p className="border-t border-red-200 bg-red-50 px-6 py-1.5 text-xs text-red-700">
              {error}
            </p>
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
            onClear={() => void chat.clear()}
            onClose={toggleChat}
          />
        )}
      </div>
    </div>
  );
}
