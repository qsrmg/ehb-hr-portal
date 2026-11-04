"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type State<T> = { path: string | null; data: T | null; error: string | null };

/** Loads a GET endpoint; `reload()` fetches it again. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ path: null, data: null, error: null });

  const fetchInto = useCallback(async (p: string) => {
    try {
      const data = await api<T>(p);
      setState({ path: p, data, error: null });
    } catch (err) {
      setState((s) => ({ path: p, data: s.data, error: (err as Error).message }));
    }
  }, []);

  useEffect(() => {
    if (path) fetchInto(path);
  }, [path, fetchInto]);

  const reload = useCallback(async () => {
    if (path) await fetchInto(path);
  }, [path, fetchInto]);

  const setData = useCallback((data: T) => setState((s) => ({ ...s, data })), []);

  return {
    data: state.data,
    error: state.error,
    loading: !!path && state.path !== path,
    reload,
    setData,
  };
}
