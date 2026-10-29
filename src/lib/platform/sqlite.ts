import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db, DbResult, DbStatement } from "./types";

// D1-compatible wrapper over node:sqlite for the Node/Docker build and tests.
// Every call yields to the event loop first, so concurrent requests interleave between
// statements the way they can on D1; a batch runs synchronously inside BEGIN…COMMIT.

const tick = () => new Promise<void>((r) => setImmediate(r));
const toSql = (v: unknown): SQLInputValue => (v === undefined ? null : typeof v === "boolean" ? Number(v) : (v as SQLInputValue));

export function sqliteDb(raw: DatabaseSync): Db {
  const exec = (sql: string, params: SQLInputValue[]): DbResult => {
    const stmt = raw.prepare(sql);
    if (stmt.columns().length) return { results: stmt.all(...params) as Record<string, unknown>[], meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(stmt.run(...params).changes) } };
  };
  const statement = (sql: string, params: SQLInputValue[] = []): DbStatement & { exec(): DbResult } => ({
    bind: (...values) => statement(sql, values.map(toSql)),
    exec: () => exec(sql, params),
    all: async <T>() => (await tick(), exec(sql, params) as DbResult<T>),
    first: async <T>() => (await tick(), (exec(sql, params).results[0] as T) ?? null),
    run: async () => (await tick(), exec(sql, params)),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      await tick();
      raw.exec("BEGIN");
      try {
        const results = statements.map((s) => (s as ReturnType<typeof statement>).exec());
        raw.exec("COMMIT");
        return results;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// Applies ./migrations/*.sql not yet recorded in d1_migrations (the table `cf d1 migrations` uses).
export function applyMigrations(raw: DatabaseSync, dir = join(/* turbopackIgnore: true */ process.cwd(), "migrations")) {
  raw.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const done = new Set(raw.prepare("SELECT name FROM d1_migrations").all().map((r) => r.name));
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    raw.exec("BEGIN");
    try {
      raw.exec(readFileSync(join(dir, name), "utf8"));
      raw.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      raw.exec("COMMIT");
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }
  }
}

export function openSqlite(path: string, migrationsDir?: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
  applyMigrations(raw, migrationsDir);
  return sqliteDb(raw);
}
