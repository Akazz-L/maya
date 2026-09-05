import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  reorderDocuments,
} from '../api/endpoints';
import type { DocumentKind } from '../api/types';

export const documentsKey = (projectId: string) => ['documents', projectId] as const;
export const documentKey = (projectId: string, documentId: string) =>
  ['document', projectId, documentId] as const;

export function useDocuments(projectId: string) {
  return useQuery({
    queryKey: documentsKey(projectId),
    queryFn: () => listDocuments(projectId),
  });
}

export function useDocument(projectId: string, documentId: string | undefined) {
  return useQuery({
    queryKey: documentKey(projectId, documentId ?? ''),
    queryFn: () => getDocument(projectId, documentId!),
    enabled: !!documentId,
  });
}

export function useCreateDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { title?: string; kind?: DocumentKind }) =>
      createDocument(projectId, vars.title, vars.kind ?? 'chapter'),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentsKey(projectId) }),
  });
}

export function useDeleteDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteDocument(projectId, documentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentsKey(projectId) }),
  });
}

export function useReorderDocuments(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentIds: string[]) => reorderDocuments(projectId, documentIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentsKey(projectId) }),
  });
}

// Saving is deliberately not a hook: WorkspaceScreen calls updateDocument
// directly so it can hold the in-flight promise in a ref and await it before
// opening a stream, which is what keeps the server's append from clobbering
// the writer's last keystrokes.
