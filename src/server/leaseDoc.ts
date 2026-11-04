import type { Db } from "@/lib/platform/types";
import { NO_WORKSPACE, effective } from "./effective";

// Renders a lease's signed agreement as printable HTML, on demand, from the lease, its document's
// terms (documents.extracted: what the signed paper says, which can differ from the record), the
// unit, property, owner entity, residents, recurring charges, late-fee policy and state rules.
// The caller checks that the persona may read the lease.

type Row = Record<string, unknown>;
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "month to month");
const STATE: Record<string, string> = { TX: "Texas", GA: "Georgia", AZ: "Arizona" };

export async function renderLeaseDocument(db: Db, ws: string | null, leaseId: string): Promise<string | null> {
  const w = ws ?? NO_WORKSPACE;
  const one = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(w, ...p).first<Row>();
  const all = async (sql: string, ...p: unknown[]) => (await db.prepare(sql).bind(w, ...p).all<Row>()).results;
  const lease = await one(`SELECT * FROM ${effective("leases")} AS l WHERE l.id = ?2`, leaseId);
  if (!lease) return null;
  const [docRow, unit, prop, residents, charges, policies, rules] = await Promise.all([
    one(`SELECT * FROM ${effective("documents")} AS d WHERE d.entity_type = 'leases' AND d.entity_id = ?2 AND d.doc_type = 'Lease' LIMIT 1`, leaseId),
    one(`SELECT u.*, t.name AS type_name, t.beds, t.baths FROM ${effective("units")} AS u LEFT JOIN ${effective("unit_types")} AS t ON t.id = u.unit_type_id WHERE u.id = ?2`, lease.unit_id),
    one(`SELECT p.*, e.name AS entity_name FROM ${effective("properties")} AS p JOIN ${effective("owner_entities")} AS e ON e.id = p.owner_entity_id WHERE p.id = ?2`, lease.property_id),
    all(`SELECT r.first_name, r.last_name FROM ${effective("residents")} AS r WHERE r.household_id = ?2 ORDER BY r.is_primary DESC, r.id`, lease.household_id),
    all(`SELECT c.label, c.amount_cents FROM ${effective("recurring_charges")} AS c WHERE c.lease_id = ?2 ORDER BY c.id`, leaseId),
    all(`SELECT * FROM ${effective("late_fee_policies")} AS f WHERE f.property_id = ?2 OR f.property_id IS NULL ORDER BY f.property_id IS NULL`, lease.property_id),
    all(`SELECT * FROM ${effective("state_rules")} AS s ORDER BY s.effective_from`),
  ]);
  if (!unit || !prop) return null;
  const doc = (docRow?.extracted ? JSON.parse(String(docRow.extracted)) : {}) as { rent_cents?: number; deposit_cents?: number; start_on?: string; end_on?: string | null; term_months?: number | null };
  const rent = doc.rent_cents ?? Number(lease.rent_cents);
  const deposit = doc.deposit_cents ?? Number(lease.deposit_cents);
  const start = doc.start_on ?? String(lease.start_on);
  const end = doc.end_on === undefined ? (lease.end_on as string | null) : doc.end_on;
  const commercial = lease.kind === "Commercial";
  const state = String(prop.state);
  const rule = (name: string) => rules.filter((r) => r.state === state && r.rule === name && String(r.effective_from) <= start).at(-1)?.value as string | undefined;
  const policy = policies[0];
  const grace = Number(policy?.grace_days ?? rule("grace_days") ?? 3);
  const cap = Number(rule("late_fee_cap_pct") ?? 0);
  const fee = !policy ? "$50.00" : policy.kind === "Percent" ? `${policy.pct}% of the monthly rent` : policy.kind === "Flat" ? usd(Number(policy.flat_cents)) : `${usd(Number(policy.flat_cents))} plus ${usd(Number(policy.daily_cents))} per additional day, up to ${usd(Number(policy.max_cents ?? 15000))}`;
  const tenants = commercial ? [String((await one(`SELECT h.name FROM ${effective("households")} AS h WHERE h.id = ?2`, lease.household_id))?.name ?? "Tenant")] : residents.map((r) => `${r.first_name} ${r.last_name}`);
  const signer = lease.signed_by ? (await one(`SELECT s.name FROM ${effective("staff")} AS s WHERE s.id = ?2`, lease.signed_by))?.name : null;
  const pet = charges.find((c) => String(c.label).startsWith("Pet"));
  const parking = charges.find((c) => String(c.label).startsWith("Parking"));
  const rubs = charges.find((c) => String(c.label).startsWith("RUBS"));
  const escalations = JSON.parse(String(lease.escalations ?? "[]")) as { on: string; pct?: number }[];
  const addr = `${prop.street}, ${prop.city}, ${state} ${prop.zip}`;
  const premises = commercial ? `${unit.number}, ${prop.name}, ${addr}, approximately ${Number(unit.sqft).toLocaleString("en-US")} rentable square feet` : `Unit ${unit.number}, ${prop.name}, ${addr} (${unit.type_name ?? `${unit.beds} bed`}, about ${Number(unit.sqft).toLocaleString("en-US")} sq ft)`;

  const sections: [string, string][] = [
    ["Parties", `This ${commercial ? "Commercial Lease (triple net)" : "Residential Lease Agreement"} is between <b>${esc(prop.entity_name)}</b> ("Landlord"), by Summit Residential Partners as managing agent, and <b>${tenants.map(esc).join(", ")}</b> ("${commercial ? "Tenant" : "Resident"}"${tenants.length > 1 ? ", jointly and severally" : ""}).`],
    ["Premises", `Landlord leases to ${commercial ? "Tenant" : "Resident"} the premises at ${esc(premises)}.`],
    ["Term", `The term begins on <b>${longDate(start)}</b> and ends on <b>${longDate(end)}</b>${doc.term_months ?? lease.term_months ? ` (${doc.term_months ?? lease.term_months} months)` : ""}. ${commercial ? "" : "If neither party gives at least 60 days' written notice before the end date, this lease continues month to month at the then-current month-to-month rate."}`],
    ["Rent", `${commercial ? "Base rent" : "Monthly rent"} is <b>${usd(rent)}</b>, due on the 1st day of each month, paid through the resident portal, by ACH, check or money order. Rent for a partial first or last month is prorated by day.`],
    ["Security deposit", `${commercial ? "Tenant" : "Resident"} has paid a security deposit of <b>${usd(deposit)}</b>, held in a separate deposit account. ${STATE[state] ?? state} law requires Landlord to return it, less itemized deductions, within ${rule("deposit_return_days") ?? 30} days after ${commercial ? "Tenant" : "Resident"} surrenders the premises${rule("deposit_max_months") && rule("deposit_max_months") !== "none" ? `; it may not exceed ${rule("deposit_max_months")} months' rent` : ""}.`],
    ["Late charges", `If rent is not received in full within ${grace} day${grace === 1 ? "" : "s"} after it is due, a late fee of ${fee} is charged${cap > 0 ? `. Under ${STATE[state]} law the late fee will not exceed ${cap}% of monthly rent${state === "TX" ? " (12% for buildings with four or fewer units)" : ""}` : ". The fee is a reasonable estimate of Landlord's costs from late payment"}. A returned payment costs $35.00 and must be replaced with certified funds.`],
  ];
  if (commercial) {
    sections.push(
      ["Operating expenses (NNN)", `Tenant pays its pro-rata share (<b>${esc(lease.nnn_share_pct)}%</b>) of common area maintenance, real estate taxes and insurance. Monthly estimates: CAM ${usd(Number(lease.cam_cents ?? 0))}, taxes ${usd(Number(lease.tax_cents ?? 0))}, insurance ${usd(Number(lease.insurance_cents ?? 0))}. Landlord reconciles actual costs after each calendar year and bills or credits the difference within 120 days.`],
      ["Rent escalations", escalations.length ? `Base rent increases on these dates: ${escalations.map((e) => `${longDate(e.on)} (+${e.pct ?? 3}%)`).join("; ")}.` : "Base rent increases 3% on each anniversary of the commencement date."],
      ["Use and renewal", "Tenant may use the premises only for its stated business. Tenant has one option to renew for 5 years at 95% of fair market rent, on 6 months' written notice."],
    );
  } else {
    sections.push(
      ["Utilities", rubs ? `Resident pays electricity directly. Water, sewer and trash are billed back monthly under a ratio utility billing system (RUBS) based on occupants; the current estimate is ${usd(Number(rubs.amount_cents))} a month.` : "Resident pays electricity directly to the provider. Landlord pays water, sewer and trash."],
      ["Pets", pet ? `One pet is approved, with monthly pet rent of ${usd(Number(pet.amount_cents))}. Assistance animals are not pets and are not charged pet rent or deposits.` : "No pets without Landlord's written consent. Assistance animals are not pets and are permitted as required by law."],
      ["Parking", parking ? `${esc(parking.label)} is assigned for ${usd(Number(parking.amount_cents))} a month.` : "Unassigned surface parking is available on a first-come basis."],
      ["Renewal", "Landlord will offer renewal terms at least 60 days before the end date. Accepting a renewal offer in the resident portal creates a renewal lease on the stated terms."],
      ["Maintenance and entry", "Resident reports repairs through the resident portal. Landlord may enter with notice for repairs, inspections and showings, and without notice in an emergency."],
    );
  }
  sections.push(["Entire agreement", `This lease, its addenda and the community policies are the entire agreement. It is governed by the laws of the State of ${STATE[state] ?? state}.`]);

  const sign = (who: string, name: string, date: string | null) => `<div class="sig"><div class="line">${esc(name)}</div><div class="small">${esc(who)}${date ? ` · signed ${longDate(date)}` : " · not yet signed"}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(commercial ? "Commercial lease" : "Lease agreement")} ${esc(leaseId)}</title><meta name="robots" content="noindex">
<style>body{font:15px/1.55 Georgia,serif;color:#1f2328;max-width:760px;margin:40px auto;padding:0 24px}h1{font-size:24px;margin:0 0 4px}h2{font:600 15px/1.3 system-ui,sans-serif;margin:22px 0 6px}.small{font:12px system-ui,sans-serif;color:#57606a}.sigs{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:40px}.line{border-bottom:1px solid #1f2328;padding:24px 0 4px;font-style:italic}@media print{body{margin:0}}</style></head>
<body><h1>${commercial ? "Commercial Lease Agreement" : "Residential Lease Agreement"}</h1><div class="small">Lease ${esc(leaseId)} · ${esc(prop.name)} · ${esc(STATE[state] ?? state)}</div>
${sections.map(([h, t], i) => `<h2>${i + 1}. ${esc(h)}</h2><p>${t}</p>`).join("\n")}
<div class="sigs">${sign("Landlord's agent", signer ? `${signer}, Summit Residential Partners` : "Summit Residential Partners", lease.signed_at ? String(lease.signed_at) : null)}${tenants.map((t) => sign(commercial ? "Tenant" : "Resident", t, lease.signed_at ? String(lease.signed_at) : null)).join("")}</div>
</body></html>`;
}
