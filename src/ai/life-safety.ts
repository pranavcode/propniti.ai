import type { Role } from "@/entities/types";
import type { Db } from "@/lib/platform/types";

// Life-safety decisions (decide.ts) belong to the principal or the regional manager. Taking a vendor
// off work while it still has open emergency or life-safety jobs is one: those jobs would sit
// unassigned. This module has no app imports, so the generic record API (src/server/query.ts) and
// the AI runtime can share it.

export const LIFE_SAFETY_ROLES: Role[] = ["principal", "regional_manager"];
export const VENDOR_OFF = ["Inactive", "Do not use"];

export type Effect = { kind?: string; table?: string; id?: string; changes?: { status?: unknown } };
type Proposal = { entity_type?: unknown; entity_id?: unknown; action?: unknown; payload?: unknown };

const payloadOf = (p: Proposal) => (typeof p.payload === "string" ? safeJson(p.payload) : p.payload) as { effects?: unknown; rule?: unknown } | null;
const effectsOf = (p: Proposal): Effect[] => { const x = payloadOf(p); return x && typeof x === "object" && Array.isArray(x.effects) ? (x.effects as Effect[]) : []; };
export const isVendorOff = (e: Effect) => e?.kind === "update" && e.table === "vendors" && !!e.id && VENDOR_OFF.includes(String(e.changes?.status));

// A payment hold after a suspicious bank change: the Payables Agent's verify proposal or the Data
// Health fix for an unverified bank change. Holding payments stays the accountant's call even when
// the vendor has emergency jobs; only the vendor-off part is a life-safety decision, so the runtime
// and the executor split it out (offVendors, withoutVendorOff) instead of routing the whole hold.
export function isPaymentHold(p: Proposal): boolean {
  return p.action === "vendors.verify_bank_change" || (p.action === "data_issues.apply_fix" && payloadOf(p)?.rule === "vendors.unverified_bank_change");
}

// The vendors whose status an effect list sets to Inactive or Do not use.
export const offVendors = (effects: Effect[]) => [...new Set(effects.filter(isVendorOff).map((e) => String(e.id)))];

// The vendors a proposal takes off work and that need the life-safety approver: "stop assigning" on
// a vendor, or an effect that sets a vendor Inactive or Do not use (data fixes). Payment holds are
// left out: their vendor-off part is dropped while the vendor has open emergency jobs.
export function vendorsTurnedOff(p: Proposal): string[] {
  if (isPaymentHold(p)) return [];
  const ids = offVendors(effectsOf(p));
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
