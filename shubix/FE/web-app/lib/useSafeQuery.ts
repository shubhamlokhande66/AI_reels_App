"use client";
import { useSyncExternalStore } from "react";
import { useQuery, type DefaultError, type QueryKey, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";

const none = () => () => {};
/** false while React hydrates the server's HTML (and on the server), true after: the server snapshot is used for hydration */
export const useHydrated = () => useSyncExternalStore(none, () => true, () => false);

/** useQuery that shows "loading" while the page hydrates, as the server's HTML did. Without it, an answer that arrives
 * while React is still hydrating (another part of the page asked first) is rendered in the middle of hydration and does
 * not match the server's HTML: React error #418 ("Hydration failed"), now and then on Home. */
export function useSafeQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  const hydrated = useHydrated();
  const q = useQuery(options);
  if (hydrated) return q;
  return { ...q, data: undefined, error: null, status: "pending", fetchStatus: "fetching", isPending: true, isLoading: true, isFetching: true, isSuccess: false, isError: false, isLoadingError: false, isRefetchError: false, isFetched: false, isFetchedAfterMount: false, isPlaceholderData: false } as UseQueryResult<TData, TError>;
}
