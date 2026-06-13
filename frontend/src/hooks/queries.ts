// TanStack Query hooks for server state. Queries cover the bible/outline text
// and the per-chapter saved + in-progress state; mutations cover saving.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getBible,
  getOutline,
  saveBible,
  saveOutline,
} from '../api/endpoints';

export const bibleKey = ['bible'] as const;
export const outlineKey = ['outline'] as const;

export function useBible() {
  return useQuery({ queryKey: bibleKey, queryFn: getBible });
}

export function useOutline() {
  return useQuery({ queryKey: outlineKey, queryFn: getOutline });
}

export function useSaveBible() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveBible,
    onSuccess: () => qc.invalidateQueries({ queryKey: bibleKey }),
  });
}

export function useSaveOutline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveOutline,
    onSuccess: () => qc.invalidateQueries({ queryKey: outlineKey }),
  });
}
