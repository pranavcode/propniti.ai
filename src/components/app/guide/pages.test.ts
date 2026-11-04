import { describe, expect, it } from "vitest";
import { pageGuide } from "./pages";

const NAV = [
  { label: "Dashboard", href: "/app" },
  { label: "Properties", href: "/app/properties", help: "Every property you manage, with units, occupancy and NOI." },
  { label: "Approvals", href: "/app/ai/approvals" },
  { label: "Work orders", href: "/app/maintenance/work-orders", help: "Repair and maintenance jobs from request to completion." },
];
const PERSONA = ["Who is late on rent?", "What needs my approval today?", "Which leases expire next month without a renewal offer?"];

describe("page guide", () => {
  it("tailors prompts to a property record and keeps them to four", () => {
    const g = pageGuide("/app/properties/p01", { nav: NAV, personaPrompts: PERSONA });
    expect(g.prompts).toContain("Why did NOI change at this property?");
    expect(g.prompts).toContain("Which units are vacant here?");
    expect(g.prompts.length).toBeLessThanOrEqual(4);
    expect(g.links.some((l) => l.href === "/app/properties")).toBe(true);
  });

  it("explains a custom page in its own words, with links", () => {
    const g = pageGuide("/app/ai/approvals", { nav: NAV, personaPrompts: PERSONA });
    expect(g.title).toBe("Approvals");
    expect(g.about.length).toBeGreaterThan(20);
    expect(g.links.length).toBeGreaterThan(0);
  });

  it("falls back to the list's own help text for entity lists", () => {
    const g = pageGuide("/app/maintenance/work-orders", { nav: NAV, personaPrompts: PERSONA });
    expect(g.title).toBe("Work orders");
    expect(g.about).toContain("Repair and maintenance jobs");
  });

  it("uses the persona's questions where the page has none, without duplicates", () => {
    const g = pageGuide("/app/somewhere-new", { nav: NAV, personaPrompts: PERSONA });
    expect(g.prompts).toEqual(PERSONA);
    const today = pageGuide("/app/today", { nav: NAV, personaPrompts: PERSONA });
    expect(new Set(today.prompts).size).toBe(today.prompts.length);
  });

  it("links to sibling pages of the one the persona is on", () => {
    const g = pageGuide("/app/receivables/collections", { nav: NAV, personaPrompts: PERSONA });
    expect(g.links.map((l) => l.href)).toContain("/app/receivables/delinquency");
  });

  it("only links to pages the persona has, plus help docs", () => {
    const g = pageGuide("/app", { nav: NAV, personaPrompts: PERSONA });
    for (const l of g.links) expect(l.href === "/docs" || l.href.startsWith("/docs/") || NAV.some((n) => l.href.split("?")[0] === n.href || l.href.startsWith(n.href + "/"))).toBe(true);
  });
});
