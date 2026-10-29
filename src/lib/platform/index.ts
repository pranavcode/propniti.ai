// Runtime services that exist only on some hosts. This default (Node.js / Docker) version
// stores data in a local SQLite file; the Cloudflare build swaps in ./workers.ts via vite.config.ts.
import { openSqlite } from "./sqlite";
import type { Db, Platform } from "./types";

let db: Db | undefined;

export function getPlatform(): Platform {
  return {
    // Opened on first use, so routes that don't store data never touch the file.
    get db() {
      return (db ??= openSqlite(process.env.DATABASE_PATH ?? (process.env.NODE_ENV === "production" ? "/data/propniti.db" : ".data/propniti.db")));
    },
  };
}
