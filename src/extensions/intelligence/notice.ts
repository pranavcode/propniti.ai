import type { Row } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/effective";

// "Send notice of entry" tasks (from the pest and inspection automations): who the notice goes to.

export const isNoticeTask = (r: Row) => r.entity_type === "units" && !!r.entity_id && /^Send notice of entry\b/i.test(String(r.title ?? ""));

const LIVE = "('Active', 'Notice', 'Month-to-month')";

export type Recipient = { id: string; name: string; first_name: string; channel: "Email" | "SMS" | "Portal"; language: "en" | "es"; property_id: string };

// Residents on the unit's current lease, primary first. With `residentId`, only that resident.
export async function noticeRecipients(db: Db, ws: string, unitId: string, residentId?: string): Promise<Recipient[]> {
  const { results } = await db.prepare(
    `SELECT r.id, r.first_name, r.last_name, r.preferred_channel, r.language, r.property_id FROM ${effective("residents")} r
     WHERE r.household_id IN (SELECT l.household_id FROM ${effective("leases")} l WHERE l.unit_id = ?2 AND l.status IN ${LIVE})${residentId ? " AND r.id = ?3" : ""}
     ORDER BY r.is_primary DESC, r.last_name LIMIT 6`,
  ).bind(ws, unitId, ...(residentId ? [residentId] : [])).all<Row>();
  return results.map((r) => ({
    id: String(r.id), name: `${r.first_name} ${r.last_name}`, first_name: String(r.first_name), property_id: String(r.property_id),
    channel: r.preferred_channel === "SMS" || r.preferred_channel === "Portal" ? r.preferred_channel : "Email",
    language: r.language === "es" ? "es" : "en",
  }));
}

export const noticeRecipient = async (db: Db, ws: string, unitId: string, residentId: string) => (await noticeRecipients(db, ws, unitId, residentId))[0] ?? null;
