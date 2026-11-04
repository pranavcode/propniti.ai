// Bulk actions on lists. The action route takes BULK_CHUNK ids per request, because each record
// costs several D1 queries and one Worker invocation has a query budget. "Select all matching"
// resolves at most BULK_MATCH_CAP ids on the server, and the browser sends them chunk by chunk.

export const BULK_CHUNK = 25;
export const BULK_MATCH_CAP = 500;

export type BulkOutcome = { ok: number; failed: number; total: number; firstError?: string };

export async function runBulk(entity: string, action: string, ids: string[], onProgress: (done: number) => void, fetcher: typeof fetch = fetch): Promise<BulkOutcome> {
  const out: BulkOutcome = { ok: 0, failed: 0, total: ids.length };
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    const res = await fetcher(`/api/e/${entity}/actions/${encodeURIComponent(action)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: chunk }) });
    const body = (await res.json().catch(() => ({}))) as { ok?: number; failed?: number; error?: string; results?: { error?: string }[] };
    // 409 means every record in the chunk was refused (already done, not allowed now): keep going.
    if (!res.ok && res.status !== 409) throw new Error(body.error ?? "Couldn't reach the server. Try again.");
    out.ok += body.ok ?? 0;
    out.failed += body.failed ?? chunk.length - (body.ok ?? 0);
    out.firstError ??= body.results?.find((r) => r.error)?.error;
    onProgress(Math.min(ids.length, i + chunk.length));
  }
  return out;
}
