// Record peek URL state. `?peek=<id>` opens the drawer on the page's own entity (the list it shows);
// a link to another entity's record writes `?peek=<entity>:<id>`. Only `peek` changes, so the
// list's filters, sort and page stay in the URL untouched.

export type PeekTarget = { entity: string; id: string };

export const PEEK_PARAM = "peek";

export function peekValue(target: PeekTarget, pageEntity?: string | null) {
  // An id with a colon always carries its entity, so it can't be misread as entity:id.
  return target.entity === pageEntity && !target.id.includes(":") ? target.id : `${target.entity}:${target.id}`;
}

export function parsePeek(value: string | null | undefined, pageEntity?: string | null): PeekTarget | null {
  if (!value) return null;
  const i = value.indexOf(":");
  const t = i > 0 && /^[a-z_]+$/.test(value.slice(0, i)) ? { entity: value.slice(0, i), id: value.slice(i + 1) } : pageEntity ? { entity: pageEntity, id: value } : null;
  // "." and ".." resolve away in the record API URL, and "/" adds a path segment.
  return t && t.id && t.id !== "." && t.id !== ".." && !t.id.includes("/") ? t : null;
}

// The query string with `peek` set (or removed when value is null), keeping every other key.
export function withPeek(search: string | URLSearchParams, value: string | null) {
  const sp = new URLSearchParams(search);
  if (value) sp.set(PEEK_PARAM, value);
  else sp.delete(PEEK_PARAM);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// The value `step` places away in the list of row values, or null at either end (no wrap).
export function adjacent(values: string[], current: string, step: 1 | -1): string | null {
  const i = values.indexOf(current);
  if (i < 0) return values[step === 1 ? 0 : values.length - 1] ?? null;
  return values[i + step] ?? null;
}

// A click the browser should handle itself: new tab or window, download, or not the main button.
export function isModifiedClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}
