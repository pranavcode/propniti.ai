import "server-only";
import { CURRENT_PERIOD } from "@/seed/constants";
import { ownerLimitCents } from "../actions";
import { entitiesOf, prevMonth } from "../statements";
import { row, rows, type PortalCtx } from "./context";

// Reads for the owner portal. Everything is keyed by the owner's own entities (owner_entities.owner_id).

export type OwnerProperty = { id: string; name: string; metro: string; neighborhood: string; type: string; class: string | null; units: number; year_built: number | null; photos: string; entity: string; occupancy: number | null; noi_cents: number | null; budget_noi_cents: number | null; collected_cents: number | null; charged_cents: number | null; wo_open: number | null };

export async function ownerEntities(c: PortalCtx) {
  return entitiesOf(c, c.me);
}

export async function ownerProperties(c: PortalCtx): Promise<OwnerProperty[]> {
  const month = prevMonth(CURRENT_PERIOD);
  return rows<OwnerProperty>(c, `SELECT p.id, p.name, p.metro, p.neighborhood, p.type, p.class, p.unit_count AS units, p.year_built, p.photos, e.name AS entity,
      round(1.0 * m.occupied / nullif(m.units, 0), 4) AS occupancy, m.noi_cents, m.budget_noi_cents, m.collected_cents, m.charged_cents, m.wo_open
    FROM {properties} p JOIN {owner_entities} e ON e.id = p.owner_entity_id
    LEFT JOIN metrics_monthly m ON m.workspace_id = 'base' AND m.property_id = p.id AND m.month = ?
    WHERE e.owner_id = ? ORDER BY p.name`, month, c.me);
}

// Trailing months for the owner's properties: NOI, budget, occupancy and collections.
export async function ownerMonthly(c: PortalCtx, months = 12) {
  const to = prevMonth(CURRENT_PERIOD);
  let from = to;
  for (let i = 1; i < months; i++) from = prevMonth(from);
  const r = await rows<{ month: string; noi: number; budget: number | null; occupied: number; units: number; collected: number; charged: number }>(c,
    `SELECT m.month, sum(m.noi_cents) AS noi, sum(m.budget_noi_cents) AS budget, sum(m.occupied) AS occupied, sum(m.units) AS units, sum(m.collected_cents) AS collected, sum(m.charged_cents) AS charged
     FROM metrics_monthly m JOIN {properties} p ON p.id = m.property_id JOIN {owner_entities} e ON e.id = p.owner_entity_id
     WHERE m.workspace_id = 'base' AND e.owner_id = ? AND m.month BETWEEN ? AND ? GROUP BY m.month ORDER BY m.month`, c.me, from, to);
  return r.map((x) => ({ month: x.month, noi: x.noi / 100, budget: x.budget == null ? null : x.budget / 100, occupancy: x.units ? x.occupied / x.units : null, collections: x.charged ? x.collected / x.charged : null }));
}

export async function ownerDistributions(c: PortalCtx, limit = 18) {
  return rows<{ id: string; period: string; owner_entity_id: string; entity: string; income_cents: number; expense_cents: number; fee_cents: number; reserve_cents: number; amount_cents: number; paid_on: string; status: string | null }>(c,
    `SELECT d.id, d.period, d.owner_entity_id, e.name AS entity, d.income_cents, d.expense_cents, d.fee_cents, d.reserve_cents, d.amount_cents, d.paid_on,
       (SELECT t.status FROM {transfers} t WHERE t.id = d.transfer_id) AS status
     FROM {owner_distributions} d JOIN {owner_entities} e ON e.id = d.owner_entity_id WHERE e.owner_id = ? ORDER BY d.period DESC, d.paid_on DESC LIMIT ?`, c.me, limit);
}

export type Approval = {
  id: string; title: string; description: string; category: string; priority: string; status: string; property_id: string; property: string; unit: string | null;
  owner_entity_id: string; amount_cents: number; limit_cents: number; opened_at: string; vendor: string | null; vendor_rating: number | null;
  decision: string | null; decided_at: string | null; note: string | null; photos: { url: string; caption: string }[]; similar: { count: number; median_cents: number | null };
};

const OPEN = "('New', 'Triaged', 'Assigned', 'Scheduled', 'On hold', 'In progress')";

// Repairs over the owner's approval limit: waiting for a decision, and decided in the last 90 days.
export async function ownerApprovals(c: PortalCtx): Promise<Approval[]> {
  const ents = await ownerEntities(c);
  const limits = new Map(await Promise.all(ents.map(async (e) => [e.id, await ownerLimitCents({ db: c.db, ws: c.ws ?? "~" }, e.id)] as const)));
  const list = await rows<Omit<Approval, "limit_cents" | "photos" | "similar"> & { photos: string | null }>(c,
    `SELECT w.id, w.title, w.description, w.category, w.priority, w.status, w.property_id, p.name AS property, u.number AS unit, p.owner_entity_id,
       coalesce(w.estimate_cents, w.cost_cents, 0) AS amount_cents, w.opened_at, v.company AS vendor, v.rating AS vendor_rating,
       json_extract(a.detail, '$.decision') AS decision, a.at AS decided_at, json_extract(a.detail, '$.note') AS note,
       (SELECT json_group_array(json_object('url', ph.url, 'caption', ph.caption)) FROM {photos} ph WHERE ph.entity_type = 'work_orders' AND ph.entity_id = w.id) AS photos
     FROM {work_orders} w JOIN {properties} p ON p.id = w.property_id JOIN {owner_entities} e ON e.id = p.owner_entity_id
     LEFT JOIN {units} u ON u.id = w.unit_id LEFT JOIN {vendors} v ON v.id = w.vendor_id
     LEFT JOIN (SELECT x.* FROM {wo_events} x WHERE x.kind = 'Approval' AND x.actor_kind = 'owner') a ON a.work_order_id = w.id
     WHERE e.owner_id = ? AND (w.status IN ${OPEN} OR a.at >= date(?, '-90 days'))
     ORDER BY a.at IS NOT NULL, w.opened_at DESC LIMIT 100`, c.me, `${CURRENT_PERIOD}-04`);
  const out: Approval[] = [];
  for (const w of list) {
    const limit = limits.get(w.owner_entity_id) ?? null;
    if (limit == null || w.amount_cents <= limit) continue;
    const sim = await row<{ n: number; med: number | null }>(c,
      `SELECT count(*) AS n, (SELECT x.cost_cents FROM {work_orders} x WHERE x.category = ? AND x.cost_cents > 0 AND x.status IN ('Completed', 'Paid') ORDER BY x.cost_cents LIMIT 1 OFFSET (SELECT count(*) / 2 FROM {work_orders} y WHERE y.category = ? AND y.cost_cents > 0 AND y.status IN ('Completed', 'Paid'))) AS med
       FROM {work_orders} z WHERE z.category = ? AND z.property_id = ? AND z.status IN ('Completed', 'Paid')`, w.category, w.category, w.category, w.property_id);
    out.push({ ...w, limit_cents: limit, photos: JSON.parse(w.photos ?? "[]"), similar: { count: sim?.n ?? 0, median_cents: sim?.med ?? null } });
  }
  return out;
}

export async function pendingApprovals(c: PortalCtx) {
  return (await ownerApprovals(c)).filter((a) => !a.decision);
}

export async function ownerDocuments(c: PortalCtx) {
  return rows<{ id: string; name: string; doc_type: string | null; url: string; uploaded_at: string; filed_to: string | null }>(c,
    `SELECT d.id, d.name, d.doc_type, d.url, d.uploaded_at, d.filed_to FROM {documents} d
     WHERE (d.entity_type = 'owner_entities' AND d.entity_id IN (SELECT e.id FROM {owner_entities} e WHERE e.owner_id = ?1))
        OR (d.entity_type = 'owners' AND d.entity_id = ?1)
        OR (d.entity_type = 'properties' AND d.entity_id IN (SELECT p.id FROM {properties} p JOIN {owner_entities} e ON e.id = p.owner_entity_id WHERE e.owner_id = ?1) AND d.doc_type IN ('Insurance', 'Tax', 'Budget', 'Report', 'Inspection report'))
     ORDER BY d.uploaded_at DESC LIMIT 100`, c.me);
}
