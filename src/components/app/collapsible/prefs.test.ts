import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal cookie jar and localStorage, or ones that throw like blocked site data.
function fakeBrowser({ blocked = false } = {}) {
  const jar = new Map<string, string>();
  const store = new Map<string, string>();
  const fail = () => { throw new DOMException("blocked", "SecurityError"); };
  const document = {
    get cookie() { if (blocked) fail(); return [...jar].map(([k, v]) => `${k}=${v}`).join("; "); },
    set cookie(s: string) {
      if (blocked) fail();
      const [pair, ...attrs] = s.split(/;\s*/);
      const [k, v] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      if (attrs.some((a) => a === "Max-Age=0")) jar.delete(k); else jar.set(k, v);
    },
  };
  const localStorage = {
    getItem: (k: string) => (blocked ? fail() : store.get(k) ?? null),
    setItem: (k: string, v: string) => (blocked ? fail() : store.set(k, v)),
    removeItem: (k: string) => (blocked ? fail() : store.delete(k)),
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { localStorage });
  return { jar, store };
}

// Fresh module per test: the store keeps the parsed cookie in memory.
const load = () => import("./prefs");

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("section preferences", () => {
  it("keys by persona and section, open by default", async () => {
    fakeBrowser();
    const p = await load();
    expect(p.sectionKey("daniel", "briefing")).toBe("daniel.briefing");
    expect(p.isCollapsed("daniel.briefing")).toBe(false);
    p.setCollapsed("daniel.briefing", true);
    expect(p.isCollapsed("daniel.briefing")).toBe(true);
    expect(p.isCollapsed("marcus.briefing")).toBe(false);
    expect(p.isCollapsed("daniel.charts")).toBe(false);
  });

  it("writes the cookie the server reads, and reads it back on the next load", async () => {
    const { jar } = fakeBrowser();
    let p = await load();
    p.setCollapsed("daniel.briefing", true);
    p.setCollapsed("marcus.charts", true);
    expect(p.parseCollapsed(jar.get(p.LAYOUT_COOKIE))).toEqual(["daniel.briefing", "marcus.charts"]);
    p.setCollapsed("marcus.charts", false);
    expect(jar.get(p.LAYOUT_COOKIE)).toBe("daniel.briefing");
    p.setCollapsed("daniel.briefing", false);
    expect(jar.has(p.LAYOUT_COOKIE)).toBe(false);

    jar.set(p.LAYOUT_COOKIE, "marcus.briefing");
    vi.resetModules();
    p = await load();
    expect(p.isCollapsed("marcus.briefing")).toBe(true);
  });

  it("notifies subscribers only when something changes", async () => {
    fakeBrowser();
    const p = await load();
    const cb = vi.fn();
    const off = p.subscribe(cb);
    p.setCollapsed("daniel.briefing", true);
    p.setCollapsed("daniel.briefing", true);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    p.setCollapsed("daniel.briefing", false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed and encoded cookie values", async () => {
    const p = await load();
    expect(p.parseCollapsed(undefined)).toEqual([]);
    expect(p.parseCollapsed("")).toEqual([]);
    expect(p.parseCollapsed("daniel.briefing|<script>|nodot|a.b.c|daniel.briefing")).toEqual(["daniel.briefing"]);
    expect(p.parseCollapsed("daniel.briefing%7Cmarcus.charts")).toEqual(["daniel.briefing", "marcus.charts"]);
    expect(p.parseCollapsed("%E0%A4%A")).toEqual([]);
    expect(p.parseCollapsed(Array.from({ length: 300 }, (_, i) => `p${i}.s`).join("|"))).toHaveLength(200);
  });

  it("reset clears section state and the other layout keys, and keeps tours, tips and last persona", async () => {
    const { jar, store } = fakeBrowser();
    const p = await load();
    p.setCollapsed("daniel.briefing", true);
    jar.set("sidebar_state", "false");
    jar.set("pn_theme", "dark");
    for (const k of [...p.LAYOUT_STORAGE_KEYS, "pn_tours", "pn_guide", "pn_last_persona"]) store.set(k, "1");
    const cb = vi.fn();
    p.subscribe(cb);

    p.resetLayout();

    expect(p.isCollapsed("daniel.briefing")).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect([...jar.keys()]).toEqual(["pn_theme"]);
    expect([...store.keys()].sort()).toEqual(["pn_guide", "pn_last_persona", "pn_tours"]);
  });

  it("keeps working in memory when cookies and storage are blocked", async () => {
    fakeBrowser({ blocked: true });
    const p = await load();
    expect(p.isCollapsed("daniel.briefing")).toBe(false);
    expect(() => p.setCollapsed("daniel.briefing", true)).not.toThrow();
    expect(p.isCollapsed("daniel.briefing")).toBe(true);
    expect(() => p.resetLayout()).not.toThrow();
    expect(p.isCollapsed("daniel.briefing")).toBe(false);
  });
});
