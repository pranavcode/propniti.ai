import { describe, expect, it } from "vitest";
import { activeArea } from "./Sidebar";
import type { ShellNavSection } from "./types";

const nav: ShellNavSection[] = [
  { section: "home", label: "Home", items: [{ key: "home.maintenance", label: "Maintenance desk", href: "/app/maintenance", icon: null }] },
  { section: "operations", label: "Operations", items: [
    { key: "work_orders", label: "Work orders", href: "/app/maintenance/work-orders", icon: null, group: "Maintenance" },
    { key: "turnovers", label: "Make-ready", href: "/app/maintenance/turnovers", icon: null, group: "Maintenance" },
  ] },
  { section: "finance", label: "Finance", items: [
    { key: "charges", label: "Charges", href: "/app/receivables/charges", icon: null, group: "Receivables" },
    { key: "payments", label: "Payments", href: "/app/receivables/payments", icon: null, group: "Receivables" },
  ] },
];

describe("the sidebar area holding the current page", () => {
  it("finds the item, its section and its group", () => {
    expect(activeArea("/app/maintenance/work-orders", nav)).toEqual({ href: "/app/maintenance/work-orders", section: "operations", group: "Maintenance" });
  });
  it("keeps the list item on a record page under it", () => {
    expect(activeArea("/app/maintenance/work-orders/wo-1", nav)).toEqual({ href: "/app/maintenance/work-orders", section: "operations", group: "Maintenance" });
  });
  it("prefers the deeper list over a home page that prefixes it", () => {
    expect(activeArea("/app/maintenance/turnovers", nav).href).toBe("/app/maintenance/turnovers");
  });
  it("opens the nearest group for a page with no item of its own", () => {
    expect(activeArea("/app/receivables/delinquency", nav)).toEqual({ href: "", section: "finance", group: "Receivables" });
  });
  it("finds nothing for a page outside the sidebar", () => {
    expect(activeArea("/app/setup", nav)).toEqual({ href: "" });
  });
});
