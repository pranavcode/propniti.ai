"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Optimistic value with save, undo and rollback. The new value shows at once; on failure it rolls
// back with an error toast and Retry; on success a toast offers Undo (which saves the old value).
export function useOptimisticSave<T>(value: T, save: (next: T, prev: T) => Promise<unknown>, opts: {
  success?: string | ((next: T) => string);
  undo?: boolean;
  silent?: boolean;
} = {}) {
  const [local, setLocal] = useState(value);
  const [prevProp, setPrevProp] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(value);
  const retry = useRef<(next: T) => void>(() => {});
  // Adopt a new server value (e.g. after router.refresh()).
  if (value !== prevProp) { setPrevProp(value); setLocal(value); }
  useEffect(() => { current.current = local; }, [local]);

  const set = useCallback(async (next: T): Promise<boolean> => {
    const prev = current.current;
    current.current = next;
    setLocal(next);
    setSaving(true);
    setError(null);
    try {
      await save(next, prev);
      if (!opts.silent) {
        const msg = typeof opts.success === "function" ? opts.success(next) : opts.success ?? "Saved";
        toast.success(msg, opts.undo === false ? undefined : {
          action: {
            label: "Undo",
            onClick: () => {
              current.current = prev;
              setLocal(prev);
              save(prev, next).then(() => toast("Change undone")).catch((e: unknown) => { current.current = next; setLocal(next); toast.error(e instanceof Error ? e.message : "Couldn't undo"); });
            },
          },
        });
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't save";
      current.current = prev;
      setLocal(prev);
      setError(msg);
      toast.error(msg, { action: { label: "Retry", onClick: () => retry.current(next) } });
      return false;
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opts is read at call time
  }, [save]);

  useEffect(() => { retry.current = (next) => void set(next); }, [set]);

  return { value: local, set, saving, error };
}
