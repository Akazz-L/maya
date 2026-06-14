import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBible, getOutline, saveBible, saveOutline } from '../api/endpoints';
import type { BibleData, OutlineData } from '../api/bible-types';

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
    mutationFn: (data: BibleData) => saveBible(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: bibleKey(projectId) }),
  });
}

export function useSaveOutline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OutlineData) => saveOutline(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: outlineKey(projectId) }),
  });
}
