import type { Actor, Row } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { effective as wsEffective } from "@/server/effective";
import { AS_OF } from "@/seed/constants";
import { vendorScore, type Line, type Policy } from "./rules";
import { all, effective, OPEN_SQL, parse, scoped } from "./store";

// Read models for the maintenance pages, actions and tabs. Every list is bounded (LIMIT), and
// everything a persona sees is filtered to its property scope.

// The PO and the latest vendor submission for a work order, plus how many photos are on file.
export async function invoiceInputs(db: Db, ws: string | null, woId: string) {
  const w = ws ?? "~";
  const [po, lines, sub, photos] = await Promise.all([
    db.prepare(`SELECT p.id, p.number, p.total_cents, p.status FROM ${wsEffective("purchase_orders")} p WHERE p.work_order_id = ?2 ORDER BY p.issued_on DESC LIMIT 1`).bind(w, woId).first<{ id: string; number: string; total_cents: number; status: string }>(),
    all<Line & { po_id: string }>(db, `SELECT l.po_id, l.description, l.amount_cents FROM ${wsEffective("po_lines")} l WHERE l.po_id IN (SELECT p.id FROM ${wsEffective("purchase_orders")} p WHERE p.work_order_id = ?2) ORDER BY l.id`, [w, woId]),
    db.prepare(`SELECT e.detail, e.at, e.actor_kind FROM ${wsEffective("wo_events")} e WHERE e.work_order_id = ?2 AND e.kind = 'Submission' ORDER BY json_extract(e.detail, '$.lines') IS NULL, e.at DESC, e.seq DESC LIMIT 1`).bind(w, woId).first<{ detail: string; at: string; actor_kind: string }>(),
    db.prepare(`SELECT count(*) AS n FROM ${wsEffective("photos")} p WHERE p.entity_type = 'work_orders' AND p.entity_id = ?2`).bind(w, woId).first<{ n: number }>(),
  ]);
  const d = sub ? parse<{ invoice_number?: string; lines?: Line[]; total_cents?: number; source?: string; read_confidence?: number | null }>(sub.detail, {}) : null;
  return {
    po: po ? { ...po, lines: lines.filter((l) => l.po_id === po.id).map(({ description, amount_cents }) => ({ description, amount_cents })) } : null,
    submission: d ? { invoice_number: d.invoice_number ?? "", lines: d.lines ?? [], total_cents: Number(d.total_cents ?? 0), source: d.source ?? (sub!.actor_kind === "vendor" ? "vendor portal" : "staff"), read_confidence: d.read_confidence ?? null, at: sub!.at } : null,
    photos: Number(photos?.n ?? 0),
  };
}

// Maintenance spend policy for a property's owner entity, falling back to the org default.
export async function policyFor(db: Db, ws: string | null, propertyId: string): Promise<(Policy & { id: string; owner_entity_id: string | null }) | null> {
  const r = await db.prepare(
    `SELECT a.id, a.owner_entity_id, a.limit_cents, a.owner_approval_over_cents, a.approver_role FROM ${wsEffective("approval_policies")} a
     WHERE a.category = 'Maintenance spend' AND (a.owner_entity_id = (SELECT p.owner_entity_id FROM ${wsEffective("properties")} p WHERE p.id = ?2) OR a.owner_entity_id IS NULL)
     ORDER BY a.owner_entity_id IS NULL LIMIT 1`,
  ).bind(ws ?? "~", propertyId).first<Policy & { id: string; owner_entity_id: string | null }>();
  return r ? { ...r } : null;
}

export type RankedVendor = { id: string; company: string; trade: string; rating: number | null; open_jobs: number; on_time: number | null; median_cents: number | null; coi_expires: string | null; coi_ok: boolean; score: number; status: string };

// Vendors for a trade in the property's metro, ranked like the triage agent ranks them. Vendors
// without a current COI stay on the list, marked, so the reason they're skipped is visible.
export async function rankVendors(db: Db, ws: string | null, trade: string, propertyId: string): Promise<RankedVendor[]> {
  const metro = (await db.prepare(`SELECT metro FROM ${effective("properties", ws)} WHERE id = ?`).bind(propertyId).first<{ metro: string }>())?.metro ?? "";
  const rows = await all<Row>(db,
    `SELECT v.id, v.company, v.trade, v.rating, v.status, v.metros,
       (SELECT count(*) FROM ${effective("work_orders", ws)} w WHERE w.vendor_id = v.id AND w.status IN ('Assigned', 'Scheduled', 'In progress')) AS open_jobs,
       (SELECT CASE WHEN count(*) THEN 1.0 * sum(w.completed_at <= w.sla_due_at) / count(*) END FROM ${effective("work_orders", ws)} w WHERE w.vendor_id = v.id AND w.completed_at IS NOT NULL AND w.sla_due_at IS NOT NULL) AS on_time,
       (SELECT max(c.expires_on) FROM ${effective("vendor_cois", ws)} c WHERE c.vendor_id = v.id AND c.status <> 'Missing') AS coi_expires
     FROM ${effective("vendors", ws)} v WHERE v.trade = ? AND v.status <> 'Do not use' LIMIT 40`, [trade]);
  const costs = await all<{ vendor_id: string; cost: number }>(db,
    `SELECT w.vendor_id, w.cost_cents AS cost FROM ${effective("work_orders", ws)} w WHERE w.vendor_id IN (SELECT value FROM json_each(?)) AND w.cost_cents > 0 ORDER BY w.cost_cents LIMIT 2000`, [JSON.stringify(rows.map((r) => r.id))]);
  return rows
    .filter((r) => parse<string[]>(r.metros, []).includes(metro))
    .map((r) => {
      const xs = costs.filter((c) => c.vendor_id === r.id).map((c) => c.cost);
      const coi = (r.coi_expires as string) ?? null;
      return {
        id: String(r.id), company: String(r.company), trade: String(r.trade), status: String(r.status), rating: r.rating == null ? null : Number(r.rating), open_jobs: Number(r.open_jobs),
        on_time: r.on_time == null ? null : Number(r.on_time), median_cents: xs.length ? xs[Math.floor(xs.length / 2)] : null, coi_expires: coi, coi_ok: !!coi && coi >= AS_OF && r.status === "Active",
        score: vendorScore(r.rating as number | null, Number(r.open_jobs)),
      };
    })
    .sort((a, b) => Number(b.coi_ok) - Number(a.coi_ok) || b.score - a.score);
}

export type TriageProposal = { id: string; title: string; why: string[]; confidence: number; risk: string; model: string | null; run_id: string | null; created_at: string; amount_cents: number | null; queue_state: string; decision: string | null; changes: Row };

// The latest Maintenance Triage proposal on a work order, with its decision if any.
export async function latestTriage(db: Db, ws: string | null, woId: string): Promise<TriageProposal | null> {
  const r = await db.prepare(
    `SELECT p.*, (SELECT d.decision FROM ${effective("ai_decisions", ws)} d WHERE d.proposal_id = p.id LIMIT 1) AS decision
     FROM ${effective("ai_proposals", ws)} p WHERE p.entity_type = 'work_orders' AND p.entity_id = ? AND p.agent = 'maintenance_triage' ORDER BY p.created_at DESC LIMIT 1`,
  ).bind(woId).first<Row>();
  if (!r) return null;
  const payload = parse<{ effects?: { kind: string; changes?: Row }[] }>(r.payload, {});
  return {
    id: String(r.id), title: String(r.title), why: parse<string[]>(r.why, []), confidence: Number(r.confidence), risk: String(r.risk), model: (r.model as string) ?? null, run_id: (r.run_id as string) ?? null,
    created_at: String(r.created_at), amount_cents: r.amount_cents == null ? null : Number(r.amount_cents), queue_state: String(r.queue_state), decision: (r.decision as string) ?? null,
    changes: payload.effects?.find((e) => e.kind === "update")?.changes ?? {},
  };
}

// ---------------------------------------------------------------------------------------------
// Supervisor home
// ---------------------------------------------------------------------------------------------

export async function homeData(db: Db, ws: string | null, actor: Actor) {
  const s = scoped(actor.propertyIds, "w.property_id");
  const wo = effective("work_orders", ws);
  const today = `'${AS_OF}'`;
  const [counts, triage, invoices, turns, pm, cois, overnight] = await Promise.all([
    db.prepare(
      `SELECT count(*) AS open,
         coalesce(sum(w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) < ${today}), 0) AS past_sla,
         coalesce(sum(w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) = ${today}), 0) AS due_today,
         coalesce(sum(w.status IN ('New', 'Triaged')), 0) AS untriaged,
         coalesce(sum(w.priority = 'Emergency'), 0) AS emergencies,
         coalesce(sum(w.status = 'On hold'), 0) AS on_hold
       FROM ${wo} w WHERE w.status IN ${OPEN_SQL}${s.sql}`,
    ).bind(...s.binds).first<Record<string, number>>(),
    all<Row>(db,
      `SELECT w.id, w.title, w.priority, w.category, w.status, w.opened_at, w.sla_due_at, w.property_id, p.name AS property, '#' || u.number AS unit,
         (SELECT ph.url FROM ${effective("photos", ws)} ph WHERE ph.entity_type = 'work_orders' AND ph.entity_id = w.id LIMIT 1) AS photo,
         (SELECT ph.check_result FROM ${effective("photos", ws)} ph WHERE ph.entity_type = 'work_orders' AND ph.entity_id = w.id LIMIT 1) AS photo_check,
         (SELECT pr.title FROM ${effective("ai_proposals", ws)} pr WHERE pr.entity_id = w.id AND pr.agent = 'maintenance_triage' AND NOT EXISTS (SELECT 1 FROM ${effective("ai_decisions", ws)} d WHERE d.proposal_id = pr.id) ORDER BY pr.created_at DESC LIMIT 1) AS suggestion,
         (SELECT pr.confidence FROM ${effective("ai_proposals", ws)} pr WHERE pr.entity_id = w.id AND pr.agent = 'maintenance_triage' ORDER BY pr.created_at DESC LIMIT 1) AS confidence
       FROM ${wo} w JOIN ${effective("properties", ws)} p ON p.id = w.property_id LEFT JOIN ${effective("units", ws)} u ON u.id = w.unit_id
       WHERE w.status IN ('New', 'Triaged')${s.sql}
       ORDER BY CASE w.priority WHEN 'Emergency' THEN 0 WHEN 'Urgent' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, w.opened_at LIMIT 12`, s.binds),
    all<Row>(db,
      `SELECT w.id, w.title, p.name AS property, v.company AS vendor, w.vendor_id,
         (SELECT json_extract(e.detail, '$.total_cents') FROM ${effective("wo_events", ws)} e WHERE e.work_order_id = w.id AND e.kind = 'Submission' ORDER BY json_extract(e.detail, '$.lines') IS NULL, e.at DESC LIMIT 1) AS invoice_cents,
         (SELECT po.total_cents FROM ${effective("purchase_orders", ws)} po WHERE po.work_order_id = w.id LIMIT 1) AS po_cents
       FROM ${wo} w JOIN ${effective("properties", ws)} p ON p.id = w.property_id LEFT JOIN ${effective("vendors", ws)} v ON v.id = w.vendor_id
       WHERE w.status = 'Submitted'${s.sql} ORDER BY w.opened_at LIMIT 8`, s.binds),
    db.prepare(`SELECT count(*) AS open, coalesce(sum(t.target_ready_on < ${today}), 0) AS late FROM ${effective("turnovers", ws)} t WHERE t.status IN ('Not started', 'In progress')${scoped(actor.propertyIds, "t.property_id").sql}`).bind(...scoped(actor.propertyIds, "t.property_id").binds).first<{ open: number; late: number }>(),
    db.prepare(`SELECT count(*) AS due, coalesce(sum(m.next_due_on < ${today}), 0) AS overdue FROM ${effective("pm_schedules", ws)} m WHERE m.active = 1 AND m.next_due_on <= date(${today}, '+7 days')${scoped(actor.propertyIds, "m.property_id").sql}`).bind(...scoped(actor.propertyIds, "m.property_id").binds).first<{ due: number; overdue: number }>(),
    all<Row>(db, `SELECT c.vendor_id, v.company, c.expires_on, c.status FROM ${effective("vendor_cois", ws)} c JOIN ${effective("vendors", ws)} v ON v.id = c.vendor_id WHERE c.expires_on <= date(${today}, '+30 days') AND v.status = 'Active' ORDER BY c.expires_on LIMIT 6`),
    db.prepare(`SELECT count(*) AS runs, coalesce(sum((SELECT count(*) FROM ${effective("ai_proposals", ws)} p WHERE p.run_id = r.id)), 0) AS proposals FROM ${effective("agent_runs", ws)} r WHERE r.agent_key IN ('maintenance_triage', 'compliance') AND r.started_at >= date(${today}, '-1 day')`).first<{ runs: number; proposals: number }>(),
  ]);
  return { counts: counts ?? {}, triage, invoices, turns: turns ?? { open: 0, late: 0 }, pm: pm ?? { due: 0, overdue: 0 }, cois, overnight: overnight ?? { runs: 0, proposals: 0 } };
}

// Open maintenance proposals for the approvals card on the home page.
export async function maintenanceProposals(db: Db, ws: string | null, actor: Actor, limit = 6) {
  // Org-level proposals (vendor COIs) have no property and show to everyone in the module.
  const s = actor.propertyIds === "all" ? { sql: "", binds: [] as unknown[] } : { sql: " AND (p.property_id IS NULL OR p.property_id IN (SELECT value FROM json_each(?)))", binds: [JSON.stringify(actor.propertyIds)] };
  return all<Row>(db,
    `SELECT p.* FROM ${effective("ai_proposals", ws)} p WHERE p.agent IN ('maintenance_triage', 'compliance', 'photo_check') AND p.queue_state IN ('needs_you', 'waiting')
       AND NOT EXISTS (SELECT 1 FROM ${effective("ai_decisions", ws)} d WHERE d.proposal_id = p.id)${s.sql}
     ORDER BY CASE p.risk WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, p.created_at DESC LIMIT ${limit}`, s.binds);
}

// ---------------------------------------------------------------------------------------------
// Board, calendar and technician views
// ---------------------------------------------------------------------------------------------

export const BOARD_COLUMNS = ["New", "Triaged", "Assigned", "Scheduled", "In progress", "On hold", "Submitted"] as const;

export async function boardData(db: Db, ws: string | null, actor: Actor, f: { property?: string; priority?: string; q?: string }, perColumn = 40) {
  const s = scoped(actor.propertyIds, "w.property_id");
  const where: string[] = [];
  const binds: unknown[] = [...s.binds];
  if (f.property) { where.push("w.property_id = ?"); binds.push(f.property); }
  if (f.priority) { where.push("w.priority = ?"); binds.push(f.priority); }
  if (f.q) { where.push("(w.title LIKE ? OR w.id LIKE ?)"); binds.push(`%${f.q}%`, `%${f.q}%`); }
  const extra = where.map((x) => ` AND ${x}`).join("");
  // Per-column cap with a window function, plus the true count per column.
  const rows = await all<Row>(db,
    `SELECT * FROM (
       SELECT w.id, w.title, w.status, w.priority, w.category, w.opened_at, w.sla_due_at, w.scheduled_at, w.vendor_id, w.assignee_id, w.property_id, p.name AS property, '#' || u.number AS unit,
         v.company AS vendor, st.name AS technician,
         (w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) < '${AS_OF}') AS past_sla,
         (SELECT ph.url FROM ${effective("photos", ws)} ph WHERE ph.entity_type = 'work_orders' AND ph.entity_id = w.id LIMIT 1) AS photo,
         row_number() OVER (PARTITION BY w.status ORDER BY CASE w.priority WHEN 'Emergency' THEN 0 WHEN 'Urgent' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, w.sla_due_at) AS rn,
         count(*) OVER (PARTITION BY w.status) AS col_total
       FROM ${effective("work_orders", ws)} w JOIN ${effective("properties", ws)} p ON p.id = w.property_id LEFT JOIN ${effective("units", ws)} u ON u.id = w.unit_id
         LEFT JOIN ${effective("vendors", ws)} v ON v.id = w.vendor_id LEFT JOIN ${effective("staff", ws)} st ON st.id = w.assignee_id
       WHERE w.status IN ${OPEN_SQL}${s.sql}${extra}
     ) WHERE rn <= ${perColumn}`, binds);
  return BOARD_COLUMNS.map((status) => {
    const items = rows.filter((r) => r.status === status);
    return { status, total: Number(items[0]?.col_total ?? 0), items };
  });
}

// Work orders with a date in the month: scheduled date when set, else the SLA due date.
export async function calendarData(db: Db, ws: string | null, actor: Actor, month: string) {
  const s = scoped(actor.propertyIds, "w.property_id");
  return all<Row>(db,
    `SELECT w.id, w.title, w.status, w.priority, w.category, p.name AS property, substr(coalesce(w.scheduled_at, w.sla_due_at), 1, 10) AS day, w.scheduled_at IS NOT NULL AS scheduled,
       (w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) < '${AS_OF}') AS past_sla
     FROM ${effective("work_orders", ws)} w JOIN ${effective("properties", ws)} p ON p.id = w.property_id
     WHERE w.status IN ${OPEN_SQL} AND substr(coalesce(w.scheduled_at, w.sla_due_at), 1, 7) = ?${s.sql}
     ORDER BY day, CASE w.priority WHEN 'Emergency' THEN 0 WHEN 'Urgent' THEN 1 ELSE 2 END LIMIT 600`, [month, ...s.binds]);
}

export async function technicians(db: Db, ws: string | null, actor: Actor) {
  const s = scoped(actor.propertyIds, "w.property_id");
  return all<{ id: string; name: string; open: number }>(db,
    `SELECT st.id, st.name, count(w.id) AS open FROM ${effective("work_orders", ws)} w JOIN ${effective("staff", ws)} st ON st.id = w.assignee_id
     WHERE w.status IN ${OPEN_SQL} AND w.vendor_id IS NULL${s.sql} GROUP BY st.id ORDER BY st.name LIMIT 40`, s.binds);
}

export async function techJobs(db: Db, ws: string | null, actor: Actor, techId: string) {
  const s = scoped(actor.propertyIds, "w.property_id");
  return all<Row>(db,
    `SELECT w.id, w.title, w.description, w.status, w.priority, w.category, w.sla_due_at, w.scheduled_at, w.permission_to_enter, p.name AS property, p.street, '#' || u.number AS unit,
       (w.sla_due_at IS NOT NULL AND substr(w.sla_due_at, 1, 10) < '${AS_OF}') AS past_sla,
       (SELECT coalesce(sum(json_extract(e.detail, '$.minutes')), 0) FROM ${effective("wo_events", ws)} e WHERE e.work_order_id = w.id AND e.kind = 'Time') AS minutes,
       (SELECT json_group_array(json_object('url', ph.url, 'result', ph.check_result, 'confidence', ph.check_confidence)) FROM ${effective("photos", ws)} ph WHERE ph.entity_type = 'work_orders' AND ph.entity_id = w.id) AS photos
     FROM ${effective("work_orders", ws)} w JOIN ${effective("properties", ws)} p ON p.id = w.property_id LEFT JOIN ${effective("units", ws)} u ON u.id = w.unit_id
     WHERE w.assignee_id = ? AND w.vendor_id IS NULL AND w.status IN ('Assigned', 'Scheduled', 'In progress', 'On hold')${s.sql}
     ORDER BY w.status = 'In progress' DESC, CASE w.priority WHEN 'Emergency' THEN 0 WHEN 'Urgent' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, w.sla_due_at LIMIT 30`, [techId, ...s.binds]);
}

// Properties and units in scope, for the intake form.
export async function intakeOptions(db: Db, ws: string | null, actor: Actor) {
  const s = scoped(actor.propertyIds, "p.id");
  const props = await all<{ id: string; name: string; metro: string }>(db, `SELECT p.id, p.name, p.metro FROM ${effective("properties", ws)} p WHERE 1 = 1${s.sql} ORDER BY p.name LIMIT 60`, s.binds);
  return props;
}

export async function unitsFor(db: Db, ws: string | null, propertyId: string) {
  return all<{ id: string; label: string }>(db, `SELECT u.id, '#' || u.number AS label FROM ${effective("units", ws)} u WHERE u.property_id = ? ORDER BY u.number LIMIT 400`, [propertyId]);
}
