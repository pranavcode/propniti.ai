"use client";

import { useCallback, useEffect, useState } from "react";
import type { Row } from "@/entities/types";

export type CollabKind = "notes" | "tasks" | "activity" | "documents";
export const collabUrl = (entity: string, id: string, kind: CollabKind) => `/api/e/${encodeURIComponent(entity)}/${encodeURIComponent(id)}/${kind}`;

// Notes, tasks, activity or documents of one record (lane C: GET /api/e/{entity}/{id}/{kind}).
// `initial` skips the first fetch (server-provided rows, or the kit's sample data).
export function useCollab<T extends Row = Row>(entity: string, id: string, kind: CollabKind, initial?: T[]) {
  const [rows, setRows] = useState<T[]>(initial ?? []);
  const [total, setTotal] = useState(initial?.length ?? 0);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${collabUrl(entity, id, kind)}?size=100`, { cache: "no-store" });
      const body = (await r.json().catch(() => null)) as { rows?: T[]; total?: number; error?: string } | null;
      if (!r.ok) throw new Error(body?.error ?? `Couldn't load ${kind} (${r.status})`);
      setRows(body?.rows ?? []);
      setTotal(body?.total ?? body?.rows?.length ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't load ${kind}`);
    } finally {
      setLoading(false);
    }
  }, [entity, id, kind]);

  useEffect(() => {
    if (initial) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial is only the first render's rows
  }, [load]);

  return { rows, setRows, total, setTotal, loading, error, reload: load };
}
