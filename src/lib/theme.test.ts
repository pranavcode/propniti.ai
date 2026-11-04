import { describe, expect, it } from "vitest";
import { themeMode, themePreload } from "./theme";

// Runs the pre-paint script against a stand-in document: what <html> and the surface root end up with.
function run(mode: Parameters<typeof themePreload>[0], osDark: boolean) {
  const cls = () => { const s = new Set<string>(); return { set: s, toggle: (c: string, on: boolean) => (on ? s.add(c) : s.delete(c)) }; };
  const html = { classList: cls(), style: {} as Record<string, string> };
  const root = { classList: cls() };
  const body = { dataset: {} as Record<string, string> };
  const document = { documentElement: html, body, currentScript: { parentElement: root } };
  new Function("document", "matchMedia", themePreload(mode))(document, () => ({ matches: osDark }));
  return { html: [...html.classList.set], root: [...root.classList.set], scheme: html.style.colorScheme, surface: body.dataset.surface };
}

describe("theme", () => {
  it("follows the OS until the person picks light or dark", () => {
    expect(themeMode(undefined)).toBe("system");
    expect(themeMode("bogus")).toBe("system");
    expect(themeMode("dark")).toBe("dark");
    expect(themeMode("light")).toBe("light");
  });

  it("sets dark before the first paint when chosen, or when the OS is dark and nothing was chosen", () => {
    expect(run("dark", false)).toEqual({ html: ["dark"], root: ["dark"], scheme: "dark", surface: "app" });
    expect(run("system", true)).toEqual({ html: ["dark"], root: ["dark"], scheme: "dark", surface: "app" });
    expect(run("system", false)).toEqual({ html: [], root: [], scheme: "light", surface: "app" });
    expect(run("light", true)).toEqual({ html: [], root: [], scheme: "light", surface: "app" });
  });
});
