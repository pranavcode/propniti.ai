"use client";

import { useCallback, useSyncExternalStore } from "react";

// JSON value in localStorage, shared by every component using the same key and synced across tabs.
// Storage can be unavailable (private mode, blocked site data): reads fall back, writes are dropped.

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(key); } catch { /* unavailable */ }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: unknown = fallback;
  if (raw != null) try { value = JSON.parse(raw); } catch { /* corrupt: use fallback */ }
  cache.set(key, { raw, value });
  return value as T;
}

export function writeLocal(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* unavailable */ }
  cache.delete(key);
  listeners.get(key)?.forEach((l) => l());
}

export function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return read(key, fallback);
}

export function useLocalStorage<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback((cb: () => void) => {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(cb);
    const onStorage = (e: StorageEvent) => { if (e.key === key) { cache.delete(key); cb(); } };
    window.addEventListener("storage", onStorage);
    return () => { set!.delete(cb); window.removeEventListener("storage", onStorage); };
  }, [key]);
  const value = useSyncExternalStore(subscribe, () => read(key, fallback), () => fallback);
  const setValue = useCallback((v: T | ((prev: T) => T)) => {
    const next = typeof v === "function" ? (v as (p: T) => T)(read(key, fallback)) : v;
    writeLocal(key, next);
  }, [key, fallback]);
  return [value, setValue];
}
