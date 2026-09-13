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
import type { DocumentDetail, Issue, ProposalOutcome, ScenePlan } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ChapterToolbar } from '../components/ChapterToolbar';
import { ChatPane } from '../components/ChatPane';
import { ModelPicker } from '../components/ModelPicker';
import { UsageMeter } from '../components/UsageMeter';
import { DocumentEditor, type SaveState } from '../components/DocumentEditor';
import { DocumentSidebar } from '../components/DocumentSidebar';
import { PlanPanel } from '../components/PlanPanel';
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
const HEIGHT_KEY = 'maya.panel.height';
const CHAT_KEY = 'maya.chat.open';

/** What the plan panel's Generate Draft asks the chat; the agent reads the saved plan. */
const DRAFT_FROM_PLAN = 'Draft this chapter from the scene plan.';

export function WorkspaceScreen() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId?: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [panelHeight, setPanelHeight] = useState(
    () => Number(localStorage.getItem(HEIGHT_KEY)) || 240,
  );
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem(CHAT_KEY) !== '0');
  // The panel is open by default whenever the document has a plan or issues, so a
  // saved plan survives a reload. This override records a deliberate show/hide,
  // scoped to one document so switching documents falls back to the default.
  const [panelOverride, setPanelOverride] = useState<{ id: string; open: boolean } | null>(null);
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

  const patchCache = useCallback(
    (fields: Partial<DocumentDetail>) => {
      qc.setQueryData(documentKey(projectId!, documentId!), (old?: DocumentDetail) =>
        old ? { ...old, ...fields } : old,
      );
    },
    [qc, projectId, documentId],
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

  const planMut = useMutation({
    // The planner reads the saved brief.
    mutationFn: () => settle().then(() => generatePlan(projectId!, documentId!)),
    onSuccess: (res) => {
      patchCache({ plan: res.plan });
      applyUsage(res.usage);
      setPanelOverride({ id: documentId!, open: true });
    },
    onError: (e: Error) => {
      setError(e.message);
      me.refetch();
    },
  });

  const checkMut = useMutation({
    // Check reads Document.body server-side.
    mutationFn: () => settle().then(() => checkDocument(projectId!, documentId!)),
    onSuccess: (res) => {
      patchCache({ issues: res.issues });
      applyUsage(res.usage);
      setPanelOverride({ id: documentId!, open: true });
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

  const revise = () => runStream(reviseStreamUrl(projectId!, documentId!), null);

  const toggleChat = () =>
    setChatOpen((open) => {
      localStorage.setItem(CHAT_KEY, open ? '0' : '1');
      return !open;
    });

  const draftFromPlan = () => {
    localStorage.setItem(CHAT_KEY, '1');
    setChatOpen(true);
    void chat.send(DRAFT_FROM_PLAN);
  };

  if (!projectId) return <Navigate to="/" replace />;
  if (project.isError) return <Navigate to="/" replace />;

  const doc = document.data;
  const isChapter = doc?.kind === 'chapter';
  // A dropped plan leaves nothing to show, so the panel closes on its own.
  const hasPanelContent = Boolean(doc?.plan || doc?.issues?.length);
  const overrideApplies = panelOverride !== null && panelOverride.id === documentId;
  const panelOpen = hasPanelContent && (!overrideApplies || panelOverride.open);
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
  const chatBusy = chat.streaming !== null || pending !== null;
  const busy =
    planMut.isPending ||
    checkMut.isPending ||
    stream.isStreaming ||
    deleteDoc.isPending ||
    rewriteBusy ||
    chatBusy;

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
              busy={busy}
              aiBlocked={aiBlocked}
              onGeneratePlan={() => planMut.mutate()}
              onCheck={() => checkMut.mutate()}
              hasPanelContent={hasPanelContent}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOverride({ id: documentId!, open: !panelOpen })}
              chatOpen={chatOpen}
              onToggleChat={toggleChat}
            />
          )}

          {doc ? (
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
            />
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

          {isChapter && panelOpen && (
            <PlanPanel
              plan={doc?.plan ?? null}
              issues={doc?.issues ?? null}
              height={panelHeight}
              onHeightChange={(h) => {
                setPanelHeight(h);
                localStorage.setItem(HEIGHT_KEY, String(h));
              }}
              onPlanChange={(plan: ScenePlan) => {
                patchCache({ plan });
                save({ plan });
              }}
              onIssuesChange={(issues: Issue[]) => {
                patchCache({ issues });
                save({ issues });
              }}
              onDrop={() => {
                patchCache({ plan: null });
                save({ plan: null });
                setPanelOverride({ id: documentId!, open: false });
              }}
              onGenerateDraft={draftFromPlan}
              onRevise={revise}
              busy={busy}
              aiBlocked={aiBlocked}
            />
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
