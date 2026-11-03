import "server-only";
import { AS_OF as AS_OF_DATE } from "@/seed/constants";
import type { Db } from "@/lib/platform/types";
import { effective } from "@/server/query";
import type { GlOption, VendorFacts } from "./checks";

// Vendor history for the payables checks, read through the visitor's overlay. Shared by the AP
// inbox page and the bill tabs.

const AS_OF = "coalesce((SELECT value FROM meta WHERE key = 'as_of'), date('now'))";

export async function vendorFacts(db: Db, ws: string | null, vendorId?: string): Promise<VendorFacts[]> {
  const only = vendorId ? " AND v.id = ?" : "";
  const onlyB = vendorId ? " AND b.vendor_id = ?" : "";
  const bind = vendorId ? [vendorId] : [];
  const bills = effective("bills", ws);
  const [vendors, medians, gls] = await Promise.all([
    db.prepare(`SELECT v.id, v.company, v.trade, v.status, v.bank_last4, v.bank_changed_at,
        CAST(julianday(${AS_OF}) - julianday(substr(v.bank_changed_at, 1, 10)) AS INTEGER) AS days,
        EXISTS (SELECT 1 FROM ${effective("data_issues", ws)} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = v.id AND di.status = 'fixed' AND di.fixed_at >= v.bank_changed_at) AS verified,
        EXISTS (SELECT 1 FROM ${effective("data_issues", ws)} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = v.id AND di.status = 'open') AS open_issue
      FROM ${effective("vendors", ws)} v WHERE 1 = 1${only} ORDER BY v.company`).bind(...bind).all<{ id: string; company: string; trade: string; status: string; bank_last4: string; bank_changed_at: string | null; days: number | null; verified: number; open_issue: number }>(),
    db.prepare(`SELECT vendor_id, amount_cents, n FROM (SELECT b.vendor_id, b.amount_cents, row_number() OVER (PARTITION BY b.vendor_id ORDER BY b.amount_cents) AS rn, count(*) OVER (PARTITION BY b.vendor_id) AS n FROM ${bills} b WHERE b.status = 'Paid'${onlyB}) WHERE rn = n / 2 + 1`).bind(...bind).all<{ vendor_id: string; amount_cents: number; n: number }>(),
    db.prepare(`SELECT b.vendor_id, l.gl_account_id, count(*) AS c FROM ${effective("bill_lines", ws)} l JOIN ${bills} b ON b.id = l.bill_id WHERE 1 = 1${onlyB} GROUP BY b.vendor_id, l.gl_account_id`).bind(...bind).all<{ vendor_id: string; gl_account_id: string; c: number }>(),
  ]);
  return vendors.results.map((v) => {
    const m = medians.results.find((x) => x.vendor_id === v.id);
    const mine = gls.results.filter((x) => x.vendor_id === v.id);
    const total = mine.reduce((s, x) => s + x.c, 0);
    const top = mine.sort((a, b) => b.c - a.c)[0];
    // An open fraud issue holds payments even when the change is older than the window.
    const days = v.open_issue && (v.days == null || v.days > 60) ? 0 : v.days;
    return {
      id: v.id, company: v.company, trade: v.trade, status: v.status, medianCents: m && m.n >= 3 ? m.amount_cents : null, paidCount: m?.n ?? 0,
      usualGl: top?.gl_account_id ?? null, usualGlShare: total ? (top?.c ?? 0) / total : 0, bankLast4: v.bank_last4,
      bankChangedDays: v.bank_changed_at || v.open_issue ? days ?? 0 : null, bankVerified: !!v.verified && !v.open_issue,
    };
  });
}

export async function glOptions(db: Db, ws: string | null): Promise<GlOption[]> {
  const r = await db.prepare(`SELECT id, number, name, type FROM ${effective("gl_accounts", ws)} WHERE type IN ('Expense', 'Asset') AND number NOT IN ('1000', '1010', '1020', '1200') ORDER BY number`).all<GlOption>();
  return r.results.map((g) => ({ id: g.id, number: g.number, name: g.name, type: g.type }));
}

export async function duplicateOf(db: Db, ws: string | null, vendorId: string, invoiceNumber: string, excludeId?: string) {
  if (!invoiceNumber.trim()) return null;
  return db
    .prepare(`SELECT b.id, b.status FROM ${effective("bills", ws)} b WHERE b.vendor_id = ? AND lower(trim(b.invoice_number)) = lower(trim(?)) AND b.id <> ? AND b.status <> 'Void' ORDER BY b.bill_date DESC LIMIT 1`)
    .bind(vendorId, invoiceNumber, excludeId ?? "")
    .first<{ id: string; status: string }>()
    .then((r) => (r ? { id: r.id, status: r.status } : null));
}

export async function asOfDate(db: Db): Promise<string> {
  return (await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? AS_OF_DATE;
}
