import { describe, expect, it } from "vitest";
import { crumbsFor } from "./TopBar";
import type { ShellNavSection } from "./types";

const nav: ShellNavSection[] = [
  { section: "home", label: "Home", items: [{ key: "today", label: "Today", href: "/app/today", icon: null }, { key: "inbox", label: "Inbox", href: "/app/inbox", icon: null }] },
  { section: "operations", label: "Operations", items: [
    { key: "leasing.pipeline", label: "Pipeline", href: "/app/leasing/pipeline", icon: null, group: "Leasing" },
    { key: "leasing.listings", label: "Listings", href: "/app/leasing/listings", icon: null, group: "Leasing" },
    { key: "residents", label: "Residents", href: "/app/residents", icon: null },
  ] },
];

describe("breadcrumb links", () => {
  it("links Home to the persona's home page", () => {
    expect(crumbsFor("/app/inbox", nav, null, "/app/today")[0]).toEqual({ label: "Home", href: "/app/today" });
  });
  it("links a section and a group to their first page", () => {
    const c = crumbsFor("/app/leasing/listings", nav, null, "/app/today");
    expect(c[0]).toEqual({ label: "Operations", href: "/app/leasing/pipeline" });
    expect(c[1]).toEqual({ label: "Leasing", href: "/app/leasing/pipeline" });
  });
  it("doesn't link a crumb to the page you're on", () => {
    const c = crumbsFor("/app/leasing/pipeline", nav, null, "/app/today");
    expect(c[0].href).toBeUndefined();
    expect(c[1].href).toBeUndefined();
  });
  it("keeps the item linked on a record page", () => {
    const c = crumbsFor("/app/residents/r1", nav, "Jordan Lee", "/app/today");
    expect(c.map((x) => x.href)).toEqual(["/app/leasing/pipeline", "/app/residents", undefined]);
  });
});
