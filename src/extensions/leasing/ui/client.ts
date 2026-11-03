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
