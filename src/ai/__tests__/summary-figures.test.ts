import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import "@/entities";
import { applyMigrations, sqliteDb, D1_LIMITS } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import type { Row } from "@/entities/types";
import { formatPct } from "@/lib/format";
import { writeBase } from "@/server/base";
import { getRow } from "@/server/query";
import type { DataCtx } from "../data";
import { cachedSummary } from "../summaries";
import { unknownNumbers } from "../rules";
import { DANIEL, MARCUS } from "./fixture";

// The record page shows the record's facts (from getRow) next to its AI summary. Every figure in the
// summary must be the figure the facts panel shows, on the full seed and after a visitor's change.
const usd = (v: unknown) => `$${Math.round(Number(v)).toLocaleString("en-US")}`;
const WS = "summary-figures-workspace-0001";

let raw: DatabaseSync;
let db: Db;
beforeAll(() => {
  raw = new DatabaseSync(":memory:", { limits: D1_LIMITS });
  applyMigrations(raw);
  writeBase(raw);
  raw.exec(`INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('${WS}', 'demo', 0, ${Date.now()})`);
  db = sqliteDb(raw);
}, 120_000);

const shown = async (data: DataCtx, entity: string, id: string) => {
  const row = (await getRow({ db: data.db, ws: data.ws === "base" ? null : data.ws, actor: data.actor }, entity, id)) as Row;
  const s = await cachedSummary(data, entity, id);
  expect(row).toBeTruthy();
  expect(s).toBeTruthy();
  expect(unknownNumbers(s!.summary, s!.facts)).toEqual([]);
  return { row, s: s! };
};

function expectPropertyFigures(row: Row, text: string) {
  expect(text).toContain(formatPct(Number(row.occupancy)));
  expect(text).toContain(usd(row.noi_month));
  expect(text).toContain(usd(row.delinquent));
  expect(text).toMatch(new RegExp(`\\b${Number(row.open_work_orders)} open work orders?\\b`));
}

describe("record summaries state the facts panel's figures", () => {
  it.each(["p01", "p02", "p03"])("property %s", async (id) => {
    const { row, s } = await shown({ db, ws: "base", actor: MARCUS }, "properties", id);
    expectPropertyFigures(row, s.summary);
  });

  it.each(["v01", "v05"])("vendor %s", async (id) => {
    const { row, s } = await shown({ db, ws: "base", actor: DANIEL }, "vendors", id);
    expect(s.summary).toMatch(new RegExp(`\\b${Number(row.open_jobs)} open jobs?\\b`));
    if (row.spend_12m != null) expect(s.summary).toContain(usd(row.spend_12m));
    if (row.rating != null) expect(s.summary).toContain(String(row.rating));
  });

  it("follows a visitor's change instead of the stored text", async () => {
    const data: DataCtx = { db, ws: WS, actor: MARCUS };
    const before = await shown(data, "properties", "p03");
    const unit = raw.prepare("SELECT * FROM units WHERE workspace_id = 'base' AND property_id = 'p03' AND status = 'Occupied' LIMIT 1").get() as Record<string, string | number | null>;
    const cols = Object.keys(unit).filter((c) => c !== "seq");
    raw.prepare(`INSERT INTO units (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => (c === "workspace_id" ? WS : c === "status" ? "Vacant" : unit[c])));
    // A new request gets a new actor, so the overlay probe (cached per actor) sees the change.
    const after = await shown({ ...data, actor: { ...MARCUS } }, "properties", "p03");
    expect(after.row.occupancy).toBeLessThan(Number(before.row.occupancy));
    expectPropertyFigures(after.row, after.s.summary);
  });

  it("shows a stored model summary only while its facts still match the record", async () => {
    const data: DataCtx = { db, ws: "base", actor: DANIEL };
    const fresh = await cachedSummary(data, "properties", "p01");
    const store = (facts: object) => raw.prepare("INSERT OR REPLACE INTO ai_summaries (workspace_id, id, entity_type, entity_id, summary, facts, model, generated_at) VALUES ('base', 'sum-properties-p01', 'properties', 'p01', 'Model text.', ?, 'test-model', '2026-11-04T05:00:00Z')").run(JSON.stringify(facts));
    store(fresh!.facts);
    expect(await cachedSummary(data, "properties", "p01")).toMatchObject({ summary: "Model text.", source: "precomputed", model: "test-model" });
    store({ ...fresh!.facts, noi_month: 1 });
    const stale = await cachedSummary(data, "properties", "p01");
    expect(stale).toMatchObject({ source: "rules" });
    expect(stale!.summary).not.toBe("Model text.");
  });
});
