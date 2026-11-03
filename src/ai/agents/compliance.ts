import type { Row } from "@/entities/types";
import { daysBetween, sql } from "../data";
import { addDays, defineAgent, type Candidate } from "./framework";

// Vendor insurance certificates (COIs) and property compliance items that are expired or due within
// 30 days. An expired COI on a vendor with open jobs is a person's call: stop assigning them.

export default defineAgent({
  key: "compliance",
  name: "Compliance agent",
  ownerRole: "maintenance_supervisor",
  goal: "Keep vendor insurance and property compliance current: request renewals for certificates expiring within 30 days, flag vendors working with expired insurance, and schedule permits, inspections and certificates before they lapse.",
  tools: ["records.search", "records.get", "records.related", "messages.draft", "actions.propose"],
  triggers: { schedule: "0 15 * * *", events: ["coi.expiring"] },
  autonomy: "auto_within_policy",
  entities: ["vendor_cois", "compliance_items", "inspections"],
  actions: ["vendor_cois.request_renewal", "vendors.stop_assigning", "compliance_items.schedule"],
  maxProposals: 10,
  async collect(ctx) {
    const soon = addDays(ctx.today, 30);
    const cois = await ctx.call<{ rows: Row[] }>("records.search", { entity: "vendor_cois", filters: [{ field: "expires_on", op: "lte", value: soon }], sort: ["expires_on", "asc"], size: 40 });
    const vendorIds = [...new Set(cois.rows.map((c) => String(c.vendor_id)))];
    const vendors = vendorIds.length
      ? await sql<Row>(ctx.data, "SELECT v.id, v.company, v.email, (SELECT count(*) FROM {work_orders} w WHERE w.vendor_id = v.id AND w.status IN ('Assigned', 'Scheduled', 'In progress')) AS open_jobs, (SELECT max(c.expires_on) FROM {vendor_cois} c WHERE c.vendor_id = v.id) AS latest FROM {vendors} v WHERE v.id IN (SELECT value FROM json_each(?))", [JSON.stringify(vendorIds)], { unscoped: true })
      : [];
    const out: Candidate[] = [];
    for (const v of vendors) {
      // A newer certificate already on file covers the vendor.
      if (String(v.latest) > soon) continue;
      const expired = String(v.latest) < ctx.today;
      const days = daysBetween(ctx.today, String(v.latest));
      const facts = { vendor: String(v.company), expires_on: String(v.latest), days_left: days, open_jobs: Number(v.open_jobs) };
      const ev = [{ entity_type: "vendors", entity_id: String(v.id), label: String(v.company) }];
      if (expired && Number(v.open_jobs) > 0) {
        out.push({
          entity: "vendors", entityId: String(v.id), action: "vendors.stop_assigning", title: `${v.company} has ${v.open_jobs} open jobs with insurance expired ${v.latest}`,
          why: [`Certificate expired ${-days} days ago`, `${v.open_jobs} work orders still assigned`, "Uninsured work exposes the owner to liability"], confidence: 0.93, risk: "High", alwaysHuman: true, mandatory: true, category: "Safety", facts, evidence: ev,
          effects: [{ kind: "update", table: "vendors", id: String(v.id), changes: { status: "Inactive" } }, { kind: "task", title: `Reassign ${v.company}'s open jobs or collect a current COI`, assignee_role: "maintenance_supervisor", priority: "High" }],
          priority: 3000 - days,
        });
      }
      out.push({
        entity: "vendors", entityId: String(v.id), action: "vendor_cois.request_renewal", title: `Ask ${v.company} for a renewed insurance certificate (${expired ? "expired" : "expires"} ${v.latest})`,
        why: [expired ? `Expired ${-days} days ago` : `Expires in ${days} days`, Number(v.open_jobs) ? `${v.open_jobs} open jobs` : "No open jobs right now"], confidence: 0.95, risk: "Low", facts, evidence: ev,
        message: { party_kind: "vendor", party_id: String(v.id), subject: "Updated certificate of insurance needed", body: `Hello ${v.company}, our records show your certificate of insurance ${expired ? "expired" : "expires"} on ${v.latest}. Please upload a current certificate in the vendor portal so we can keep assigning you work.` },
        effects: [], priority: 2000 - days,
      });
    }
    const items = await ctx.call<{ rows: Row[] }>("records.search", { entity: "compliance_items", filters: [{ field: "status", op: "ne", value: "Done" }, { field: "due_on", op: "lte", value: soon }], sort: ["due_on", "asc"], size: 20 });
    for (const c of items.rows) {
      const days = daysBetween(ctx.today, String(c.due_on));
      out.push({
        entity: "compliance_items", entityId: String(c.id), propertyId: (c.property_id as string) ?? null, action: "compliance_items.schedule",
        title: `${days < 0 ? "Overdue" : "Due soon"}: ${c.title} (${c.due_on})`, why: [`${c.kind} ${days < 0 ? `overdue by ${-days} days` : `due in ${days} days`}`], confidence: 0.9, risk: days < 0 ? "Medium" : "Low",
        facts: { item: String(c.title), due_on: String(c.due_on), days_left: days }, evidence: [{ entity_type: "compliance_items", entity_id: String(c.id), label: String(c.title) }],
        effects: [{ kind: "task", title: `Schedule: ${c.title}`, detail: `${c.kind} due ${c.due_on}.`, property_id: (c.property_id as string) ?? null, assignee_role: "property_manager", priority: days < 0 ? "High" : "Normal", due_on: days < 0 ? ctx.today : String(c.due_on) }],
        priority: 1500 - days,
      });
    }
    return out;
  },
});
