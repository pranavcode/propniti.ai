import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { D1_LIMITS } from "./sqlite";

// Local SQLite refuses what D1 refuses, so a query that would break on Cloudflare breaks in tests.
describe("D1 limits on node:sqlite", () => {
  const db = new DatabaseSync(":memory:", { limits: D1_LIMITS });
  const refuses = (sql: string) => expect(() => db.prepare(sql)).toThrow();
  it("refuses compound SELECTs over 5 terms, 101 columns, 101 parameters, deep expressions and 100 KB statements", () => {
    refuses("SELECT 1" + " UNION ALL SELECT 1".repeat(5));
    expect(() => db.prepare("SELECT 1" + " UNION ALL SELECT 1".repeat(4))).not.toThrow();
    refuses("SELECT " + Array.from({ length: 101 }, (_, i) => i).join(", "));
    refuses("SELECT " + Array.from({ length: 101 }, (_, i) => `?${i + 1}`).join(", "));
    refuses("SELECT " + Array(150).fill("1").join(" + "));
    refuses("SELECT 1 " + " ".repeat(100_001));
  });
});
