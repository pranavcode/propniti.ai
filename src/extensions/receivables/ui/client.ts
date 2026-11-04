// Calls a named action on one record (POST /api/e/<entity>/<id>/actions/<action>).
export async function runAction(entity: string, id: string, action: string, body: unknown = {}): Promise<{ ok: true; message?: string; href?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/e/${entity}/${encodeURIComponent(id)}/actions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, message: out.message, href: out.href } : { ok: false, error: out.error ?? "Nothing was changed. Try again." };
  } catch {
    return { ok: false, error: "You're offline or the server didn't answer. Nothing was changed." };
  }
}

export const usd = (dollars: number) => dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const newKey = () => crypto.randomUUID().replace(/-/g, "");
