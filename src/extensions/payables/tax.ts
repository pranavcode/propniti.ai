import "server-only";
import type { Actor } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/query";

// 1099-NEC preparation: what each owner entity (the payer) paid each 1099 vendor in a tax year,
// from vendor payouts that left trust. The reporting threshold is $600 for payments through 2025
// and $2,000 from 2026 (One Big Beautiful Bill Act, 2025).

export const threshold1099 = (year: number) => (year >= 2026 ? 2000 : 600);

export type Row1099 = {
  vendor_id: string; company: string; owner_entity_id: string; payer: string; paid: number; payments: number;
  w9: boolean; tin: boolean; form_id: string | null; form_status: string | null; form_amount: number | null;
  state: "Reportable" | "Near threshold" | "Below threshold";
  flags: string[];
};

export function classify(paid: number, year: number): Row1099["state"] {
  const t = threshold1099(year);
  if (paid >= t) return "Reportable";
  return paid >= t * 0.85 ? "Near threshold" : "Below threshold";
}

export async function prepare1099(db: Db, ws: string | null, actor: Actor, year: number) {
  const scope = actor.propertyIds === "all" ? "" : " AND t.property_id IN (SELECT value FROM json_each(?2))";
  const r = await db
    .prepare(`SELECT t.to_id AS vendor_id, v.company, v.w9_on_file, v.tin_last4, t.owner_entity_id, coalesce(oe.name, t.owner_entity_id) AS payer, sum(t.amount_cents) AS cents, count(*) AS n,
        f.id AS form_id, f.status AS form_status, f.amount_cents AS form_cents
      FROM ${effective("transfers", ws)} t
      JOIN ${effective("vendors", ws)} v ON v.id = t.to_id
      LEFT JOIN ${effective("owner_entities", ws)} oe ON oe.id = t.owner_entity_id
      LEFT JOIN ${effective("vendor_1099s", ws)} f ON f.vendor_id = t.to_id AND f.owner_entity_id = t.owner_entity_id AND f.year = ?1
      WHERE t.kind = 'Vendor payout' AND t.status <> 'Returned' AND substr(coalesce(t.cleared, t.created), 1, 4) = ?1 AND v.is_1099 = 1${scope}
      GROUP BY t.to_id, t.owner_entity_id ORDER BY cents DESC`)
    .bind(String(year), ...(actor.propertyIds === "all" ? [] : [JSON.stringify(actor.propertyIds)]))
    .all<{ vendor_id: string; company: string; w9_on_file: number; tin_last4: string; owner_entity_id: string; payer: string; cents: number; n: number; form_id: string | null; form_status: string | null; form_cents: number | null }>();
  const excluded = await db.prepare(`SELECT count(DISTINCT v.id) AS n FROM ${effective("vendors", ws)} v WHERE v.is_1099 = 0`).first<{ n: number }>();
  const rows: Row1099[] = r.results.map((x) => {
    const paid = x.cents / 100;
    const state = classify(paid, year);
    const flags: string[] = [];
    if (state === "Reportable" && !x.w9_on_file) flags.push("No W-9 on file: request one before filing, or apply backup withholding");
    if (state === "Reportable" && !x.tin_last4) flags.push("No TIN on file");
    if (x.form_cents != null && Math.abs(x.form_cents - x.cents) > 100) flags.push(`Form amount $${(x.form_cents / 100).toLocaleString("en-US")} differs from payments`);
    if (state === "Near threshold") flags.push(`Within 15% of the $${threshold1099(year).toLocaleString("en-US")} threshold; December payments could make it reportable`);
    return { vendor_id: x.vendor_id, company: x.company, owner_entity_id: x.owner_entity_id, payer: x.payer, paid, payments: x.n, w9: !!x.w9_on_file, tin: !!x.tin_last4, form_id: x.form_id, form_status: x.form_status, form_amount: x.form_cents == null ? null : x.form_cents / 100, state, flags };
  });
  return { rows, threshold: threshold1099(year), excludedVendors: excluded?.n ?? 0 };
}
