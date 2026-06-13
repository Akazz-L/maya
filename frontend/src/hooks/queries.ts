// TanStack Query hooks for server state. Queries cover the bible/outline text
// for a project; mutations cover saving. Keys are scoped by project id.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBible, getOutline, saveBible, saveOutline } from '../api/endpoints';

export const bibleKey = (projectId: string) => ['bible', projectId] as const;
export const outlineKey = (projectId: string) => ['outline', projectId] as const;

export function useBible(projectId: string) {
  return useQuery({ queryKey: bibleKey(projectId), queryFn: () => getBible(projectId) });
}

export function useOutline(projectId: string) {
  return useQuery({ queryKey: outlineKey(projectId), queryFn: () => getOutline(projectId) });
}

export function useSaveBible(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => saveBible(projectId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: bibleKey(projectId) }),
  });
}

export function useSaveOutline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => saveOutline(projectId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: outlineKey(projectId) }),
  });
}
