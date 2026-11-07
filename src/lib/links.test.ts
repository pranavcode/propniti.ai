import { describe, expect, it } from "vitest";
import { getEntity } from "@/entities";
import { safeHref } from "./links";

const good = ["/docs/lease.pdf", "/app/documents/d1?x=1", "https://files.example.com/a.pdf", "HTTPS://files.example.com/a.pdf"];
const bad = ["/\\evil.com", "/\\/evil.com", "//evil.com", "/\t/evil.com", "/\n/evil.com", " //evil.com", "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "http://evil.com", "evil.com", "", "\\\\evil.com"];

describe("document links", () => {
  it("renders only same-site paths and https links", () => {
    for (const u of good) expect(safeHref(u)).toBe(u);
    for (const u of bad) expect(safeHref(u), JSON.stringify(u)).toBeUndefined();
    expect(safeHref(42)).toBeUndefined();
  });

  it("accepts the same links on write", () => {
    const url = getEntity("documents")!.fields.url.zod!;
    for (const u of good) expect(url.safeParse(u).success, u).toBe(true);
    for (const u of bad) expect(url.safeParse(u).success, JSON.stringify(u)).toBe(false);
  });
});
