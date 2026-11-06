import type { Role } from "@/entities/types";
import type { Db } from "@/lib/platform/types";

// Life-safety decisions (decide.ts) belong to the principal or the regional manager. Taking a vendor
// off work while it still has open emergency or life-safety jobs is one: those jobs would sit
// unassigned. This module has no app imports, so the generic record API (src/server/query.ts) and
// the AI runtime can share it.

export const LIFE_SAFETY_ROLES: Role[] = ["principal", "regional_manager"];
export const VENDOR_OFF = ["Inactive", "Do not use"];

type Effect = { kind?: string; table?: string; id?: string; changes?: { status?: unknown } };

// The vendors a proposal takes off work: "stop assigning" on a vendor, or an effect that sets a
// vendor's status to Inactive or Do not use (bank-change holds, data fixes).
export function vendorsTurnedOff(p: { entity_type?: unknown; entity_id?: unknown; action?: unknown; payload?: unknown }): string[] {
  const payload = typeof p.payload === "string" ? safeJson(p.payload) : p.payload;
  const effects = (payload && typeof payload === "object" && Array.isArray((payload as { effects?: unknown }).effects) ? (payload as { effects: Effect[] }).effects : []);
  const ids = effects.filter((e) => e?.kind === "update" && e.table === "vendors" && e.id && VENDOR_OFF.includes(String(e.changes?.status))).map((e) => String(e.id));
  if (p.entity_type === "vendors" && p.action === "vendors.stop_assigning") ids.push(String(p.entity_id));
  return [...new Set(ids)];
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Open emergency or life-safety work orders on these vendors, in the workspace (overlay over base).
export async function safetyJobs(db: Db, ws: string, vendorIds: string[]): Promise<number> {
  if (!vendorIds.length) return 0;
  const r = await db
    .prepare(
      `SELECT count(*) AS n FROM work_orders w WHERE w.workspace_id IN ('base', ?) AND w.deleted = 0 AND w.vendor_id IN (SELECT value FROM json_each(?))
         AND (w.workspace_id = ? OR NOT EXISTS (SELECT 1 FROM work_orders o WHERE o.workspace_id = ? AND o.id = w.id))
         AND w.status NOT IN ('Completed', 'Paid', 'Cancelled') AND (w.priority = 'Emergency' OR w.category = 'Life safety')`,
    )
    .bind(ws, JSON.stringify(vendorIds), ws, ws)
    .first<{ n: number }>();
  return Number(r?.n ?? 0);
}

export const safetyJobsNote = (n: number) => `${n} open emergency or life-safety work order${n === 1 ? "" : "s"} still assigned`;
