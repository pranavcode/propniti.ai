import { demoNowIso } from "@/lib/clock";
import type { Row } from "@/entities/types";
import { daysBetween, parseJson, sql } from "../data";
import { defineAgent, money, type Candidate } from "./framework";
import { billChecks } from "../rules";
export { billChecks } from "../rules";

// Bills waiting for approval: read the scanned invoice's extracted fields (from /api/ai/extract,
// stored on documents.extracted), check the coding against the vendor's trade, compare the amount
// with the vendor's history, catch duplicates, and stop payment to vendors whose bank details
// changed without verification.

export default defineAgent({
  key: "ap",
  name: "Payables agent",
  ownerRole: "accountant",
  goal: "Review every bill waiting for approval: check the scanned invoice, GL coding, amount against the vendor's history and duplicates, and stop payment to any vendor whose bank details changed without verification. Clean bills get an approval proposal.",
  tools: ["records.search", "records.get", "records.related", "policy.lookup", "actions.propose"],
  triggers: { schedule: "0 */2 * * *", events: ["invoice.received", "vendor.bank_changed"] },
  autonomy: "act_with_approval",
  entities: ["bills", "vendors"],
  actions: ["bills.approve", "bills.hold", "vendors.verify_bank_change"],
  maxProposals: 10,
  async collect(ctx) {
    const bills = await ctx.call<{ rows: Row[] }>("records.search", { entity: "bills", filters: [{ field: "status", op: "eq", value: "Pending approval" }], sort: ["due_on", "asc"], size: 25 });
    const ids = bills.rows.map((b) => String(b.id));
    if (!ids.length) return [];
    const rows = await sql<Row>(ctx.data,
      `SELECT b.id, b.property_id, b.vendor_id, b.invoice_number, b.amount_cents, b.due_on, b.bill_date, v.company, v.trade, v.bank_changed_at, d.extracted,
              (SELECT count(*) FROM {bills} x WHERE x.vendor_id = b.vendor_id AND x.invoice_number = b.invoice_number AND x.id <> b.id) AS duplicates,
              (SELECT group_concat(g.name, '|') FROM {bill_lines} l JOIN {gl_accounts} g ON g.id = l.gl_account_id WHERE l.bill_id = b.id) AS gl_names
       FROM {bills} b JOIN {vendors} v ON v.id = b.vendor_id LEFT JOIN {documents} d ON d.id = b.document_id WHERE b.id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(ids)]);
    const hist = await sql<{ vendor_id: string; amount_cents: number }>(ctx.data, "SELECT vendor_id, amount_cents FROM {bills} WHERE vendor_id IN (SELECT value FROM json_each(?)) AND status = 'Paid' ORDER BY vendor_id, amount_cents", [JSON.stringify(rows.map((r) => r.vendor_id))], { unscoped: true });
    const out: Candidate[] = [];
    const flaggedVendors = new Set<string>();
    for (const b of rows) {
      const xs = hist.filter((h) => h.vendor_id === b.vendor_id).map((h) => h.amount_cents);
      const extracted = parseJson<{ total?: number } | null>(b.extracted, null);
      const c = billChecks({
        amount_cents: Number(b.amount_cents), median_cents: xs.length >= 3 ? xs[Math.floor(xs.length / 2)] : null, duplicates: Number(b.duplicates),
        bank_changed_days: b.bank_changed_at ? daysBetween(String(b.bank_changed_at).slice(0, 10), ctx.today) : null,
        gl_names: String(b.gl_names ?? "").split("|").filter(Boolean), trade: String(b.trade), extracted_total_cents: extracted?.total != null ? Math.round(extracted.total * 100) : null,
      });
      const facts = { vendor: String(b.company), invoice_number: String(b.invoice_number), amount_cents: Number(b.amount_cents), due_on: String(b.due_on) };
      const ev = [{ entity_type: "bills", entity_id: String(b.id), label: `${b.company} ${b.invoice_number}` }, { entity_type: "vendors", entity_id: String(b.vendor_id), label: String(b.company) }];
      if (c.fraud && !flaggedVendors.has(String(b.vendor_id))) {
        flaggedVendors.add(String(b.vendor_id));
        out.push({
          entity: "vendors", entityId: String(b.vendor_id), propertyId: String(b.property_id), action: "vendors.verify_bank_change",
          title: `Hold payments to ${b.company} until the bank change is verified`, why: c.issues, confidence: 0.95, risk: "High", alwaysHuman: true, mandatory: true, facts, evidence: ev,
          effects: [{ kind: "update", table: "vendors", id: String(b.vendor_id), changes: { status: "Inactive" } }, { kind: "task", title: `Verify ${b.company}'s bank change by phone (number on file)`, detail: c.issues.join(" "), assignee_role: "accountant", priority: "High" }],
          priority: 5000,
        });
      }
      if (c.issues.length) {
        out.push({
          entity: "bills", entityId: String(b.id), propertyId: String(b.property_id), action: "bills.hold", title: `Hold ${b.company} ${b.invoice_number} (${money(Number(b.amount_cents))}) — ${c.issues.length} issue${c.issues.length > 1 ? "s" : ""}`,
          why: c.issues, confidence: 0.85, risk: c.fraud ? "High" : "Medium", alwaysHuman: true, mandatory: c.fraud, facts, evidence: ev,
          effects: [{ kind: "task", title: `Review bill ${b.invoice_number} from ${b.company}`, detail: c.issues.join(" "), assignee_role: "accountant", priority: c.fraud ? "High" : "Normal", due_on: String(b.due_on) }],
          priority: 3000 + c.issues.length,
        });
      } else {
        out.push({
          entity: "bills", entityId: String(b.id), propertyId: String(b.property_id), action: "bills.approve", title: `Approve ${b.company} ${b.invoice_number} — ${money(Number(b.amount_cents))}`,
          why: ["Amount in line with this vendor's history", "GL coding matches the vendor's trade", "No duplicate invoice; bank details unchanged"], confidence: 0.9, risk: "Low",
          category: "Bill payment", amountCents: Number(b.amount_cents), facts, evidence: ev,
          effects: [{ kind: "update", table: "bills", id: String(b.id), changes: { status: "Approved", approved_by: "$by", approved_at: demoNowIso() } }],
          priority: 1000,
        });
      }
    }
    return out;
  },
});
