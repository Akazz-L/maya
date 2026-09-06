import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  checkDocument,
  draftStreamUrl,
  generatePlan,
  getProject,
  reviseStreamUrl,
  updateDocument,
  type DocumentPatch,
} from '../api/endpoints';
import type { DocumentDetail, Issue, ScenePlan } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ChapterToolbar } from '../components/ChapterToolbar';
import { DocumentEditor, type SaveState } from '../components/DocumentEditor';
import { DocumentSidebar } from '../components/DocumentSidebar';
import { PlanPanel } from '../components/PlanPanel';
import { Button } from '../components/ui/button';
import { useDraftStream } from '../hooks/useDraftStream';
import {
  documentKey,
  documentsKey,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useDocuments,
  useReorderDocuments,
} from '../hooks/queries';

const COLLAPSE_KEY = 'maya.sidebar.collapsed';
const HEIGHT_KEY = 'maya.panel.height';

export function WorkspaceScreen() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId?: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [panelHeight, setPanelHeight] = useState(
    () => Number(localStorage.getItem(HEIGHT_KEY)) || 240,
  );
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

  // Holds the in-flight autosave so a stream can wait for it to land before the
  // server appends to `body`. Without this the server appends to a stale body
  // and the writer's last keystrokes vanish.
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());

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

  const planMut = useMutation({
    mutationFn: () => generatePlan(projectId!, documentId!),
    onSuccess: (res) => {
      patchCache({ plan: res.plan });
      setPanelOverride({ id: documentId!, open: true });
    },
    onError: (e: Error) => setError(e.message),
  });

  const checkMut = useMutation({
    // Check reads Document.body server-side, so the pending autosave must land first.
    mutationFn: () => pendingSave.current.then(() => checkDocument(projectId!, documentId!)),
    onSuccess: (res) => {
      patchCache({ issues: res.issues });
      setPanelOverride({ id: documentId!, open: true });
    },
    onError: (e: Error) => setError(e.message),
  });

  /** Flush pending autosave, then stream; the server owns `body` for the duration. */
  const runStream = async (url: string, body: unknown) => {
    setError(null);
    await pendingSave.current;
    setStreamBody(document.data?.body ?? '');
    try {
      await stream.run(url, body, {
        onDelta: (text) => setStreamBody((prev) => (prev ?? '') + text),
        onDone: (full) => {
          patchCache({ body: full });
          setStreamBody(undefined);
          setDocVersion((v) => v + 1); // remount the editor onto the server's body
        },
      });
    } catch (e) {
      setError((e as Error).message);
      setStreamBody(undefined);
    }
  };

  const generateDraft = async () => {
    let plan: ScenePlan | null = document.data?.plan ?? null;
    if (!plan) {
      // No plan yet: plan first, then draft straight through.
      try {
        plan = (await planMut.mutateAsync()).plan;
      } catch {
        return; // planMut.onError already surfaced it
      }
    }
    setPanelOverride({ id: documentId!, open: true });
    await runStream(draftStreamUrl(projectId!, documentId!), { plan });
  };

  const revise = () => runStream(reviseStreamUrl(projectId!, documentId!), null);

  if (!projectId) return <Navigate to="/" replace />;
  if (project.isError) return <Navigate to="/" replace />;

  const doc = document.data;
  const isChapter = doc?.kind === 'chapter';
  // A dropped plan leaves nothing to show, so the panel closes on its own.
  const hasPanelContent = Boolean(doc?.plan || doc?.issues?.length);
  const overrideApplies = panelOverride !== null && panelOverride.id === documentId;
  const panelOpen = hasPanelContent && (!overrideApplies || panelOverride.open);
  const busy =
    planMut.isPending ||
    checkMut.isPending ||
    stream.isStreaming ||
    deleteDoc.isPending ||
    rewriteBusy;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f0]">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            ← Projects
          </Button>
          <h1 className="text-base font-semibold text-gray-800">{project.data?.name ?? '…'}</h1>
        </div>
        <Button variant="secondary" size="sm" onClick={logout}>
          Log out
        </Button>
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
              onGeneratePlan={() => planMut.mutate()}
              onGenerateDraft={generateDraft}
              onCheck={() => checkMut.mutate()}
              hasPanelContent={hasPanelContent}
              panelOpen={panelOpen}
              onTogglePanel={() =>
                setPanelOverride({ id: documentId!, open: !panelOpen })
              }
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
              onGenerateDraft={generateDraft}
              onRevise={revise}
              busy={busy}
            />
          )}
        </div>
      </div>
    </div>
  );
}
