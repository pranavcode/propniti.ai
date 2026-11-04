"use client";

// Browser side of the leasing actions: POST /api/e/[entity]/[id]/actions/[key]. AI actions send
// their result back as JSON in `message`, with the agent run's page in `href`.

export async function callAction(entity: string, id: string, action: string, body: unknown = {}): Promise<{ message: string; href?: string }> {
  const res = await fetch(`/api/e/${entity}/${encodeURIComponent(id)}/actions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error(out.error ?? "Nothing was changed. Check your connection and try again.");
  return { message: String(out.message ?? ""), href: out.href };
}

export async function callAi<T>(entity: string, id: string, action: string): Promise<T & { runId: string; source: "live" | "rules"; model: string }> {
  const r = await callAction(entity, id, action);
  try {
    return JSON.parse(r.message);
  } catch {
    throw new Error("The agent's reply couldn't be read. Try again, or open the run from AI activity.");
  }
}

export async function patchRecord(entity: string, id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/e/${entity}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error(out.error ?? "Couldn't save. Try again.");
  return out;
}

export async function createRecord(entity: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`/api/e/${entity}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error(out.error ?? "Couldn't create it. Try again.");
  return (out.row ?? out) as { id: string };
}

export const runHref = (id: string | null | undefined) => (id ? `/app/ai/runs/${id}` : undefined);

export type BulkResult = { ok: number; failed: number; errors: string[] };

// Runs a bulk action over any number of records, `chunk` ids per request (the route caps a request
// at 25), reporting progress after each request. Each record keeps its own checks and audit row.
export async function runBulk(entity: string, action: string, ids: string[], opts: { input?: unknown; chunk?: number; onProgress?: (done: number) => void } = {}): Promise<BulkResult> {
  const size = opts.chunk ?? 25;
  const out: BulkResult = { ok: 0, failed: 0, errors: [] };
  for (let i = 0; i < ids.length; i += size) {
    const part = ids.slice(i, i + size);
    const res = await fetch(`/api/e/${entity}/actions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: part, ...(opts.input === undefined ? {} : { input: opts.input }) }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    // A refused request (rate limit, lost connection) stops the run; what was done stays done.
    if (!res || !Array.isArray(body.results)) {
      out.failed += ids.length - i;
      out.errors.push(body.error ?? "Couldn't reach the server. Try again.");
      break;
    }
    for (const r of body.results as { status: number; error?: string }[]) {
      if (r.status === 200) out.ok++;
      else { out.failed++; if (r.error) out.errors.push(r.error); }
    }
    opts.onProgress?.(Math.min(ids.length, i + size));
  }
  return out;
}

// "Sent 24 · 2 skipped: Maya already got a follow-up today"
export const bulkSummary = (r: BulkResult, verb: string) => `${verb} ${r.ok}${r.failed ? ` · ${r.failed} skipped${r.errors[0] ? `: ${r.errors[0]}` : ""}` : ""}`;
