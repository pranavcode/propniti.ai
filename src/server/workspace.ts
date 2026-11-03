import { clientKey } from "@/lib/guard";
import type { Db } from "@/lib/platform/types";
import { DEMO_RESET_TZ, DEMO_TODAY } from "@/lib/seed";
import { AS_OF } from "@/seed/constants";
import { randomId, type WorkspaceRow } from "./repo";

// Each visitor gets a private overlay on the shared base data, found by a random id in an
// HttpOnly cookie. Creating one is a single row; resetting it deletes the row, which cascades to
// the overlay only (base rows belong to workspace 'base', which no cookie can name).
export const COOKIE = "pn_ws";
const ID = /^[A-Za-z0-9_-]{22,64}$/;
const CREATE_LIMIT = 30;
const CREATE_WINDOW_MS = 3_600_000;
const SWEEP_BATCH = 50;

// Wall-clock time of `ms` in `tz`, expressed as a UTC timestamp.
function wallClock(ms: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(ms)
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// Demo workspaces are deleted at the first midnight in DEMO_RESET_TZ after they are created.
// Finds that instant by converting local midnight to UTC, re-checking the offset once for DST.
export function nextMidnight(nowMs: number, tz = DEMO_RESET_TZ) {
  const local = new Date(wallClock(nowMs, tz));
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  let utc = target - (wallClock(target, tz) - target);
  utc -= wallClock(utc, tz) - target;
  return utc;
}

// Legacy (0001) timestamps: the old demo date with the current time of day.
export const stamp = (nowMs: number) => `${DEMO_TODAY} ${new Date(wallClock(nowMs, DEMO_RESET_TZ)).toISOString().slice(11, 16)}`;
// v2 timestamps: the demo's "today" (meta.as_of) with the current wall-clock time, ISO-8601.
export const nowIso = (nowMs: number) => `${AS_OF}T${new Date(wallClock(nowMs, DEMO_RESET_TZ)).toISOString().slice(11, 19)}Z`;

export function readCookie(request: Request) {
  const raw = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  const id = raw?.slice(COOKIE.length + 1);
  return id && ID.test(id) ? id : null;
}

export const cookieHeader = (id: string) =>
  `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

async function ipHash(request: Request, onCloudflare: boolean) {
  const key = clientKey(request, onCloudflare);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return { shared: key === "shared", hash: btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 12))) };
}

const BASE_VERSION_SQL = "(SELECT value FROM meta WHERE key = 'base_version')";

// Creates the workspace: one row, stamped with the base version its overlay is built on. Also
// deletes a few expired workspaces, so old demos are cleaned up without a scheduled job.
async function clone(db: Db, ws: string, nowMs: number, createdBy: string | null) {
  await db.batch([
    db.prepare(`DELETE FROM workspaces WHERE id IN (SELECT id FROM workspaces WHERE id <> 'base' AND expires_at <= ?1 LIMIT ${SWEEP_BATCH})`).bind(nowMs),
    db.prepare("DELETE FROM workspaces WHERE id = ?1 AND id <> 'base' AND (expires_at <= ?2 OR base_version IS NOT " + BASE_VERSION_SQL + ")").bind(ws, nowMs),
    db.prepare(`INSERT OR IGNORE INTO workspaces (id, kind, created_at, created_by, last_seen_at, expires_at, base_version) VALUES (?1, 'demo', ?2, ?3, ?2, ?4, ${BASE_VERSION_SQL})`).bind(ws, nowMs, createdBy, nextMidnight(nowMs)),
  ]);
}

// Puts the workspace back to the base data (drops its overlay), keeping its id and expiry.
export async function resetWorkspace(db: Db, ws: string, nowMs: number) {
  if (ws === "base") return;
  const w = await db.prepare("SELECT * FROM workspaces WHERE id = ?1").bind(ws).first<WorkspaceRow>();
  if (!w) return;
  await db.batch([
    db.prepare("DELETE FROM workspaces WHERE id = ?1").bind(ws),
    db.prepare(`INSERT INTO workspaces (id, kind, created_at, created_by, last_seen_at, expires_at, base_version) VALUES (?1, 'demo', ?2, ?3, ?4, ?5, ${BASE_VERSION_SQL})`).bind(ws, w.created_at, w.created_by, nowMs, w.expires_at),
  ]);
}

export type Resolved = { ws: string | null; setCookie?: string };

// Finds the caller's workspace. An expired one is wiped and started fresh under the same id.
// A new one is only created when `create` is set (a write) or the cookie came back to us, so
// clients that never return cookies (crawlers) get seed data without a workspace per request.
// Returns ws null when the caller should see seed data computed in memory.
export async function resolveWorkspace(db: Db, request: Request, nowMs: number, create: boolean, onCloudflare: boolean): Promise<Resolved | Response> {
  const cookieId = readCookie(request);
  if (cookieId) {
    const row = await db
      .prepare(`SELECT expires_at, last_seen_at, created_by, base_version IS ${BASE_VERSION_SQL} AS current FROM workspaces WHERE id = ?1`)
      .bind(cookieId)
      .first<{ expires_at: number | null; last_seen_at: number; created_by: string | null; current: number }>();
    // An overlay built on an older base is wiped and started fresh (ids rarely change, but seq does).
    if (row && row.current && (row.expires_at == null || row.expires_at > nowMs)) {
      if (row.last_seen_at < nowMs - 60_000) await db.prepare("UPDATE workspaces SET last_seen_at = ?2 WHERE id = ?1").bind(cookieId, nowMs).run();
      return { ws: cookieId };
    }
    if (row) {
      await clone(db, cookieId, nowMs, row.created_by);
      return { ws: cookieId };
    }
  }
  const id = cookieId ?? randomId();
  const setCookie = cookieId ? undefined : id;
  if (!cookieId && !create) return { ws: null, setCookie };
  const ip = await ipHash(request, onCloudflare);
  const recent = await db.prepare("SELECT count(*) AS n FROM workspaces WHERE created_by = ?1 AND created_at > ?2").bind(ip.hash, nowMs - CREATE_WINDOW_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= (ip.shared ? CREATE_LIMIT * 20 : CREATE_LIMIT)) {
    return create ? Response.json({ error: "Too many new demo sessions from your network. Try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } }) : { ws: null };
  }
  await clone(db, id, nowMs, ip.hash);
  return { ws: id, setCookie };
}
