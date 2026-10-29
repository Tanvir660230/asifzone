"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListPreferences } from "@clothing-brand/shared";
import * as adminHomeApi from "@/lib/api/admin-home";
import { listPreferenceKeys } from "@/lib/query-keys";

/**
 * One admin's display preferences for one list (density, page size, hidden columns — Order Operations plan M10), kept on
 * the server so they follow the admin between devices. A change shows at once and is saved in the background; a failed
 * save leaves the change on screen for this session. `ready` turns true once the stored preferences are known (or
 * couldn't be read), so a list can wait for them instead of loading twice.
 */
export function useListPreferences(listKey: string) {
  const queryClient = useQueryClient();
  const key = listPreferenceKeys.list(listKey);
  const { data, isSuccess, isError } = useQuery({ queryKey: key, queryFn: () => adminHomeApi.getListPreferences(listKey), staleTime: Infinity, retry: 1 });
  const save = useMutation({ mutationFn: (patch: ListPreferences) => adminHomeApi.updateListPreferences(listKey, patch) });
  return {
    prefs: data ?? {},
    ready: isSuccess || isError,
    update(patch: ListPreferences) {
      queryClient.setQueryData<ListPreferences>(key, (cur) => ({ ...cur, ...patch }));
      save.mutate(patch);
    },
  };
}
