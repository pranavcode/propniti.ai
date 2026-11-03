"use client";

import { readLocal, writeLocal } from "@/hooks/use-local-storage";
import type { ViewState } from "@/entities/types";
import type { SavedView } from "./types";

// Saved views. The server adapter uses lane C's /api/views (saved_views table); if that fails the
// table falls back to views kept in this browser.
export interface SavedViewsAdapter {
  list(entity: string): Promise<SavedView[]>;
  save(entity: string, name: string, state: ViewState, shared: boolean): Promise<SavedView>;
  remove(entity: string, key: string): Promise<void>;
}

export const localViews: SavedViewsAdapter = {
  async list(entity) { return readLocal<SavedView[]>(`pn_views:${entity}`, []); },
  async save(entity, name, state, shared) {
    const v: SavedView = { key: `local-${Date.now().toString(36)}`, label: name, shared, mine: true, ...state };
    writeLocal(`pn_views:${entity}`, [...readLocal<SavedView[]>(`pn_views:${entity}`, []), v]);
    return v;
  },
  async remove(entity, key) { writeLocal(`pn_views:${entity}`, readLocal<SavedView[]>(`pn_views:${entity}`, []).filter((v) => v.key !== key)); },
};

export const serverViews: SavedViewsAdapter = {
  async list(entity) {
    const r = await fetch(`/api/views?entity=${encodeURIComponent(entity)}`, { cache: "no-store" });
    if (!r.ok) return localViews.list(entity);
    return [...((await r.json()) as { views: SavedView[] }).views, ...(await localViews.list(entity))];
  },
  async save(entity, name, state, shared) {
    const r = await fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, name, shared, state }) });
    if (!r.ok) return localViews.save(entity, name, state, shared);
    return ((await r.json()) as { view: SavedView }).view;
  },
  async remove(entity, key) {
    if (key.startsWith("local-")) return localViews.remove(entity, key);
    await fetch(`/api/views/${encodeURIComponent(key)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
  },
};
