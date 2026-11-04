// Which home and dashboard sections are collapsed, per browser and per persona. Kept in the
// pn_layout cookie rather than localStorage so the server renders collapsed sections collapsed
// (no flash or layout jump on load). Keys are "<persona>.<section>"; sections are open by default.
// No account sync: the cookie lives in this browser only, and the midnight demo reset leaves it alone.

export const LAYOUT_COOKIE = "pn_layout";
const SEP = "|";
const KEY = /^[\w-]+\.[\w-]+$/;
const MAX_KEYS = 200;
const YEAR = 31_536_000;

// What "Reset layout" clears besides pn_layout: sidebar width and section/group state, the
// assistant panel and the peek drawer width. Tours, tips, last persona, theme, density, saved
// views, table columns, recent records and setup progress are kept.
export const LAYOUT_STORAGE_KEYS = ["pn_nav_closed", "pn_nav_groups", "pn_ai_open", "pn_ai_w", "pn_peek_w"];
export const LAYOUT_COOKIES = [LAYOUT_COOKIE, "sidebar_state"];

export const sectionKey = (persona: string, section: string) => `${persona}.${section}`;

export function parseCollapsed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { /* not encoded */ }
  return [...new Set(s.split(SEP).filter((k) => KEY.test(k)))].slice(0, MAX_KEYS);
}

export const serializeCollapsed = (keys: Iterable<string>) => [...keys].filter((k) => KEY.test(k)).slice(0, MAX_KEYS).join(SEP);

// Browser side. Cookies can be blocked: reads fall back to "all open" and the state still works
// for this page view from memory.

function readCookie(name: string): string | null {
  try {
    return document.cookie.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  } catch { return null; }
}

function writeCookie(name: string, value: string, maxAge: number) {
  try { document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax`; } catch { /* blocked */ }
}

let current: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function collapsedKeys(): ReadonlySet<string> {
  return (current ??= new Set(parseCollapsed(readCookie(LAYOUT_COOKIE))));
}

export const isCollapsed = (key: string) => collapsedKeys().has(key);

export function setCollapsed(key: string, collapsed: boolean) {
  if (isCollapsed(key) === collapsed) return;
  const next = new Set(collapsedKeys());
  if (collapsed) next.add(key); else next.delete(key);
  current = next;
  const value = serializeCollapsed(next);
  writeCookie(LAYOUT_COOKIE, value, value ? YEAR : 0);
  emit();
}

export function resetLayout() {
  for (const c of LAYOUT_COOKIES) writeCookie(c, "", 0);
  for (const k of LAYOUT_STORAGE_KEYS) try { window.localStorage.removeItem(k); } catch { /* blocked */ }
  current = new Set();
  emit();
}
