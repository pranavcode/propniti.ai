"use client";

import { useEffect } from "react";
import { readLocal, useLocalStorage, writeLocal } from "@/hooks/use-local-storage";

// Recently viewed records (⌘K "Recent", home). Kept per browser in localStorage.
export type RecentRecord = { entity: string; id: string; title: string; subtitle?: string; href: string; at: number };

const KEY = "pn_recent";
const MAX = 15;

export function trackRecent(r: Omit<RecentRecord, "at">) {
  const list = readLocal<RecentRecord[]>(KEY, []).filter((x) => x.href !== r.href);
  writeLocal(KEY, [{ ...r, at: Date.now() }, ...list].slice(0, MAX));
}

export function useTrackRecent(r: Omit<RecentRecord, "at"> | null) {
  const href = r?.href, title = r?.title;
  useEffect(() => {
    if (r && href && title) trackRecent(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- track once per record and title
  }, [href, title]);
}

const EMPTY: RecentRecord[] = [];
export function useRecent() {
  return useLocalStorage<RecentRecord[]>(KEY, EMPTY)[0];
}
