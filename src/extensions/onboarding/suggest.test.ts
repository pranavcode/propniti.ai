import { describe, expect, it } from "vitest";
import { median, niceCeil, niceFloor, percentile, suggestAutonomy, suggestPolicies, type PolicyNow, type Stats } from "./suggest";

// Approval limits and agent autonomy sized to the portfolio. Every figure is computed here from the
// workspace's records; the basis text quotes the same figures.

const policy = (category: string, limit: number | null, owner: number | null = null, always = false): PolicyNow => ({ id: `pol-${category}`, category, limit, owner, approver: "property_manager", alwaysHuman: always });
const POLICIES = [policy("Maintenance spend", 750, 2500), policy("Bill payment", 5000, 25000), policy("Concession", 0), policy("Write-off", 0), policy("Owner distribution", null), policy("Legal", null, null, true), policy("Safety", null, null, true)];
const wo = [120, 180, 260, 300, 350, 400, 410, 410, 480, 640, 900, 1200, 1830, 2400, 3100];
const stats = (over: Partial<Stats> = {}): Stats => ({ units: 420, unitsFrom: "import", workOrders: wo, bills: Array.from({ length: 40 }, (_, i) => 200 + i * 50), rents: [1100, 1250, 1450, 1450, 1600, 1800], rentsFrom: "import", ...over });

describe("helpers", () => {
  it("median, percentile and round-number limits", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9.1);
    expect([niceCeil(410), niceCeil(72.5), niceCeil(1830), niceCeil(12_340)]).toEqual([500, 75, 2000, 13_000]);
    expect([niceFloor(362.5), niceFloor(72.5), niceFloor(10)]).toEqual([300, 50, 25]);
  });
});

describe("suggestPolicies", () => {
  it("sizes maintenance spend from the median work order, with the basis spelled out", () => {
    const s = suggestPolicies(stats(), POLICIES).find((x) => x.category === "Maintenance spend")!;
    expect(s.suggested).toEqual({ limit: 500, owner: 2500 });
    expect(s.current).toEqual({ limit: 750, owner: 2500 });
    expect(s.basis).toBe("Median completed work order $410 across 15 jobs → auto-approve up to $500. 90th percentile $2,172 → owner approves above $2,500.");
    expect(s.sample).toBe(15);
    expect(s.confidence).toBe("Medium");
    expect(s.changed).toBe(true);
  });

  it("sizes bills, concessions and write-offs from bills and rents", () => {
    const by = Object.fromEntries(suggestPolicies(stats(), POLICIES).map((s) => [s.category, s]));
    expect(by["Bill payment"]!.suggested).toEqual({ limit: 1500, owner: 2500 });
    expect(by["Bill payment"]!.confidence).toBe("High");
    expect(by.Concession!.suggested.limit).toBe(300);
    expect(by.Concession!.basis).toMatch(/^Median rent \$1,450 on 6 imported leases → concessions up to \$300 \(a quarter of a month's rent, rounded down\)/);
    expect(by["Write-off"]!.suggested.limit).toBe(50);
    expect(by["Write-off"]!.basis).toMatch(/5% of the median rent/);
  });

  it("never suggests automating legal, safety or owner distributions", () => {
    const cats = suggestPolicies(stats(), POLICIES).map((s) => s.category);
    expect(cats).not.toContain("Legal");
    expect(cats).not.toContain("Safety");
    expect(cats).not.toContain("Owner distribution");
  });

  it("skips a category with too few records and says why", () => {
    const s = suggestPolicies(stats({ workOrders: [300, 900] }), POLICIES).find((x) => x.category === "Maintenance spend")!;
    expect(s.suggested).toEqual(s.current);
    expect(s.changed).toBe(false);
    expect(s.confidence).toBe("Low");
    expect(s.basis).toMatch(/Only 2 completed work orders/);
  });

  it("says when the figures come from the workspace rather than the import", () => {
    const s = suggestPolicies(stats({ rentsFrom: "workspace" }), POLICIES).find((x) => x.category === "Concession")!;
    expect(s.basis).toMatch(/6 leases in this workspace/);
  });

  it("marks a suggestion that matches the current policy as unchanged", () => {
    const s = suggestPolicies(stats(), [policy("Maintenance spend", 500, 2500)])[0]!;
    expect(s.changed).toBe(false);
  });
});

describe("suggestAutonomy", () => {
  const agents = ["data_health", "compliance", "maintenance_triage", "ap", "collections", "leasing", "renewals", "owner_reporting"].map((key) => ({ key, name: key, autonomy: "act_with_approval" }));
  const level = (units: number) => Object.fromEntries(suggestAutonomy(units, "import", agents).map((s) => [s.key, s.suggested]));

  it("keeps a small portfolio on approve-first everywhere", () => {
    expect(new Set(Object.values(level(80)))).toEqual(new Set(["act_with_approval"]));
    expect(suggestAutonomy(80, "import", agents)[0]!.basis).toMatch(/^80 imported units/);
  });

  it("lets routine agents act within policy from 100 units; money agents still ask", () => {
    const l = level(420);
    expect([l.data_health, l.compliance, l.maintenance_triage]).toEqual(["auto_within_policy", "auto_within_policy", "auto_within_policy"]);
    expect([l.ap, l.collections, l.leasing, l.renewals, l.owner_reporting]).toEqual(Array(5).fill("act_with_approval"));
  });

  it("adds bill payment under the limit from 1,000 units", () => {
    expect(level(1500).ap).toBe("auto_within_policy");
    expect(suggestAutonomy(1500, "stated", agents).find((s) => s.key === "ap")!.basis).toMatch(/^1,500 units \(your estimate\)/);
  });
});
