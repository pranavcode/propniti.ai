import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { BASE_VERSION, baseHash, generate, type Base, type Value } from "@/seed/generate";

// Loads the generated base dataset (workspace_id = 'base'). Node/SQLite runs the generator in
// process (ensureBase); D1 gets the same rows from .seed/base.sql (scripts/seed-d1.mjs).
// Reloading the base also wipes every visitor overlay: overlay seq must always exceed base seq,
// because owner statements close by seq cutoff (plan §1).

let cached: Base | undefined;
export const baseData = () => (cached ??= generate());

// Tables in insert order. Every table in the base except meta and base_balances.
export const baseTables = (b: Base) => Object.keys(b.tables);

const columnsOf = (rows: Record<string, Value>[]) => {
  const groups = new Map<string, Record<string, Value>[]>();
  for (const r of rows) {
    const k = Object.keys(r).join(",");
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return groups;
};

// Loads the base with the same statements the D1 load runs (baseSql), so local SQLite and D1 take
// the identical path and both stay inside D1's statement limits.
export function writeBase(raw: DatabaseSync, b: Base = baseData()) {
  raw.exec("BEGIN");
  try {
    for (const sql of baseSql(b)) raw.exec(sql);
    raw.exec("COMMIT");
  } catch (e) {
    raw.exec("ROLLBACK");
    throw e;
  }
}

// Runs the generator when the stored base is missing or from another generator version, then
// loads .seed/ai-precompute.sql (real model summaries written by the AI lane) when it exists.
export function ensureBase(raw: DatabaseSync, root = process.cwd()) {
  const version = (raw.prepare("SELECT value FROM meta WHERE key = 'base_version'").get() as { value?: string } | undefined)?.value;
  if (version !== BASE_VERSION) writeBase(raw);
  const file = join(root, ".seed", "ai-precompute.sql");
  if (!existsSync(file)) return;
  const sql = readFileSync(file, "utf8");
  const h = String(sql.length) + ":" + sql.slice(0, 64);
  const loaded = (raw.prepare("SELECT value FROM meta WHERE key = 'ai_precompute'").get() as { value?: string } | undefined)?.value;
  if (loaded === h && version === BASE_VERSION) return;
  raw.exec("BEGIN");
  try {
    raw.exec(sql.replace(/INSERT INTO ai_summaries/gi, "INSERT OR REPLACE INTO ai_summaries"));
    raw.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('ai_precompute', ?)").run(h);
    raw.exec("COMMIT");
  } catch (e) {
    raw.exec("ROLLBACK");
    throw e;
  }
}

const utf8 = new TextEncoder();
const lit = (v: Value) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// The base as SQL statements for D1: multi-row INSERTs kept under D1's 100 KB statement limit.
export function* baseSql(b: Base = baseData(), maxBytes = 60_000): Generator<string> {
  yield "DELETE FROM workspaces WHERE id <> 'base';";
  for (const t of baseTables(b)) yield `DELETE FROM ${t} WHERE workspace_id = 'base';`;
  yield "DELETE FROM base_balances;";
  yield "DELETE FROM meta;";
  for (const t of baseTables(b)) {
    for (const [cols, rows] of columnsOf(b.tables[t])) {
      const head = `INSERT INTO ${t} (workspace_id, ${cols}) VALUES `;
      const names = cols.split(",");
      let parts: string[] = [];
      let size = head.length;
      for (const r of rows) {
        const v = `('base', ${names.map((n) => lit(r[n])).join(", ")})`;
        const bytes = utf8.encode(v).length;
        if (parts.length && (size + bytes + 2 > maxBytes || parts.length >= 500)) {
          yield head + parts.join(", ") + ";";
          parts = [];
          size = head.length;
        }
        parts.push(v);
        size += bytes + 2;
      }
      if (parts.length) yield head + parts.join(", ") + ";";
    }
  }
  yield `INSERT INTO base_balances (account_id, cleared_cents) VALUES ${b.balances.map((x) => `(${lit(x.account_id)}, ${x.cleared_cents})`).join(", ")};`;
  yield `INSERT INTO meta (key, value) VALUES ${Object.entries({ ...b.meta, base_hash: baseHash(b) }).map(([k, v]) => `(${lit(k)}, ${lit(v)})`).join(", ")};`;
}
