import type { InboxCounts } from "./data";

// Inbox counts per workspace and persona for up to 30 s, so the sidebar badge doesn't query D1 on
// every /app render. Writes that change a count (decisions, replies, thread edits, alerts read)
// drop the workspace's entries. The map lives in one isolate: another isolate may serve a stale
// count until its own entry expires.
const TTL_MS = 30_000;
const MAX = 500;
const entries = new Map<string, { at: number; v: InboxCounts }>();
const wsKey = (ws: string | null) => ws ?? "base";

// `fresh` skips the cached entry (the inbox page lists from these counts) and stores the new one.
export async function cachedCounts(ws: string | null, personaId: string, load: () => Promise<InboxCounts>, nowMs = Date.now(), fresh = false): Promise<InboxCounts> {
  const key = `${wsKey(ws)}|${personaId}`;
  const hit = entries.get(key);
  if (!fresh && hit && nowMs - hit.at < TTL_MS) return hit.v;
  const v = await load();
  if (entries.size >= MAX) entries.clear();
  entries.set(key, { at: nowMs, v });
  return v;
}

export function forgetInboxCounts(ws: string | null) {
  const prefix = `${wsKey(ws)}|`;
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
}
