// Calls the generic entity API from the AP inbox and the bill tabs. Errors come back as { error }.

export async function post<T = { ok?: boolean; message?: string; href?: string; row?: Record<string, unknown> }>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error((out as { error?: string }).error ?? "Nothing was changed. Try again.");
  return out as T;
}

export const runBillAction = (billId: string, action: string, input: unknown = {}) =>
  post<{ ok: boolean; message?: string; href?: string }>(`/api/e/bills/${encodeURIComponent(billId)}/actions/${encodeURIComponent(action)}`, input);
