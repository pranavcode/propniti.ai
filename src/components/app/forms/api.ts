// JSON fetch for the generic entity API. Errors come back as { error } (src/app/api/e/_lib/http.ts).
export async function apiJson<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined && method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const recordUrl = (entity: string, id?: string) => `/api/e/${encodeURIComponent(entity)}${id ? `/${encodeURIComponent(id)}` : ""}`;
