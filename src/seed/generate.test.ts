import { describe, expect, it } from "vitest";
import { MANAGEMENT_FEE_RATE } from "@/lib/ledger";
import { AS_OF, INFLOW, PERIODS, baseHash, generate, type R } from "./generate";
import { pctOf } from "./rng";

// Plan §3 reconciliation asserts, in integer cents, on the generated rows.
const b = generate();
const T = b.tables;
const sum = (rows: R[], f: (r: R) => number) => rows.reduce((s, r) => s + f(r), 0);
const group = (rows: R[], key: (r: R) => string | null, val: (r: R) => number) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k !== null) m.set(k, (m.get(k) ?? 0) + val(r));
  }
  return m;
};
const cents = (r: R, k = "amount_cents") => r[k] as number;
const flagged = (rule: string) => new Set((T.data_issues ?? []).filter((i) => i.rule_id === rule).map((i) => i.entity_id as string));

describe("seed generator", () => {
  it("is deterministic: the same base hash on every run", { timeout: 120_000 }, () => {
    expect(baseHash(generate())).toBe(baseHash(b));
    expect(b.meta.as_of).toBe(AS_OF);
  });

  it("generates the ids personas reference", () => {
    const ids = (t: string) => new Set(T[t].map((r) => r.id));
    for (const r of ["r-tx", "r-se", "r-sw"]) expect(ids("regions")).toContain(r);
    for (let i = 1; i <= 30; i++) expect(ids("properties")).toContain(`p${String(i).padStart(2, "0")}`);
    expect(ids("owners")).toContain("ow01");
    expect(ids("vendors")).toContain("v01");
    expect(T.vendors.find((v) => v.id === "v01")).toMatchObject({ company: "Lone Star Plumbing", contact_name: "Luis Ramirez" });
    const jordan = T.residents.find((r) => r.id === "res-p01-0001")!;
    expect(jordan).toMatchObject({ first_name: "Jordan", last_name: "Lee", property_id: "p01", status: "Current" });
    const lease = T.leases.find((l) => l.household_id === jordan.household_id && l.status === "Active")!;
    expect(T.units.find((u) => u.id === lease.unit_id)?.number).toBe("412");
    expect(T.properties.filter((p) => p.region_id === "r-tx")).toHaveLength(14);
    expect(T.units).toHaveLength(3318);
  });

  it("has 18 closed months plus the current one, with no money dated after today", () => {
    expect(PERIODS[0]).toBe("2025-05");
    expect(PERIODS.at(-1)).toBe("2026-11");
    expect(T.charges.every((c) => (c.due_on as string) <= AS_OF)).toBe(true);
    expect(T.payments.every((p) => (p.received_on as string) < AS_OF)).toBe(true);
    expect(T.transfers.every((t) => (t.created as string) < `${AS_OF}T23:59`)).toBe(true);
  });

  it("dates nothing that already happened after the demo's today morning", () => {
    const past = ["created_at", "at", "opened_at", "completed_at", "sent_at", "submitted_at", "decided_at", "detected_at", "generated_at", "uploaded_at", "approved_at", "signed_at", "started_at", "ended_at", "cleared", "created"];
    for (const [name, rows] of Object.entries(T)) for (const r of rows) for (const k of past) if (typeof r[k] === "string" && (r[k] as string)[10] === "T") expect((r[k] as string) <= `${AS_OF}T08:00:00Z`, `${name}.${k} = ${r[k]}`).toBe(true);
  });

  it("stores lease and household balances that match the ledger rows", () => {
    const bal = new Map<string, number>();
    for (const x of T.charges) bal.set(x.lease_id as string, (bal.get(x.lease_id as string) ?? 0) + cents(x));
    for (const x of T.payments) if (!x.nsf) bal.set(x.lease_id as string, (bal.get(x.lease_id as string) ?? 0) - cents(x));
    for (const x of T.credits) bal.set(x.lease_id as string, (bal.get(x.lease_id as string) ?? 0) - cents(x));
    for (const l of T.leases) expect(l.balance_cents, l.id as string).toBe(bal.get(l.id as string) ?? 0);
    expect(sum(T.households, (h) => h.balance_cents as number)).toBe(sum(T.leases, (l) => l.balance_cents as number));
  });

  it("rent roll: each current lease bills its scheduled rent this month", () => {
    const nov = new Map(T.charges.filter((c) => c.period === "2026-11" && c.gl_account_id === "gl-4000").map((c) => [c.lease_id as string, c]));
    const corrupted = new Set([...flagged("leases.rent_outlier"), ...flagged("leases.end_before_start")]);
    const current = T.leases.filter((l) => !corrupted.has(l.id as string) && l.kind === "Residential" && ["Active", "Notice", "Eviction"].includes(l.status as string) && (l.start_on as string) <= "2026-11-01" && (!l.move_out_on || (l.move_out_on as string) >= "2026-11-30"));
    expect(current.length).toBeGreaterThan(2500);
    let checked = 0;
    for (const l of current) {
      if ((l.rent_cents as number) === 0) continue;
      // Past its end date on month-to-month terms: $100 month-to-month premium.
      const premium = l.end_on && (l.end_on as string) < "2026-11-01" ? 10_000 : 0;
      expect(cents(nov.get(l.id as string)!), l.id as string).toBe((l.rent_cents as number) + premium);
      checked++;
    }
    expect(checked).toBe(current.filter((l) => l.rent_cents).length);
  });

  it("AR: charges − payments − credits = the change in receivables per property-month", () => {
    const charged = group(T.charges, (c) => `${c.property_id}|${c.period}`, cents);
    const paid = group(T.payments, (p) => (p.nsf ? null : `${p.property_id}|${(p.received_on as string).slice(0, 7)}`), cents);
    const credited = group(T.credits, (c) => `${c.property_id}|${(c.on_date as string).slice(0, 7)}`, cents);
    const ar = group(T.journal_entries.filter((j) => j.gl_account_id === "gl-1200"), (j) => `${j.property_id}|${j.period}`, (j) => cents(j, "debit_cents") - cents(j, "credit_cents"));
    const keys = new Set([...charged.keys(), ...paid.keys(), ...credited.keys(), ...ar.keys()]);
    for (const k of keys) expect(ar.get(k) ?? 0, k).toBe((charged.get(k) ?? 0) - (paid.get(k) ?? 0) - (credited.get(k) ?? 0));
  });

  it("deposits into trust = payments − NSF returns", () => {
    const batches = T.transfers.filter((t) => t.from_kind === "batch");
    expect(sum(batches, cents)).toBe(sum(T.payments.filter((p) => !p.nsf), cents));
    const byBatch = group(T.payments.filter((p) => !p.nsf), (p) => p.transfer_id as string, cents);
    for (const t of batches) expect(byBatch.get(t.id as string), t.id as string).toBe(t.amount_cents);
    const nsf = T.payments.filter((p) => p.nsf);
    expect(nsf.length).toBeGreaterThan(50);
    for (const p of nsf) expect(T.transfers.find((t) => t.id === p.transfer_id)?.status).toBe("Returned");
  });

  it("trust: opening + receipts − disbursements = base_balances, and ties to the cash GL", () => {
    const signed = group(T.transfers.filter((t) => t.status === "Cleared"), (t) => t.bank_account_id as string, (t) => (INFLOW.has(t.kind as string) ? 1 : -1) * cents(t));
    expect(Object.fromEntries(b.balances.map((x) => [x.account_id, x.cleared_cents]))).toEqual(Object.fromEntries(signed));
    for (const x of b.balances) expect(x.cleared_cents, x.account_id).toBeGreaterThan(0);
    const cash = (glId: string) => group(T.journal_entries.filter((j) => j.gl_account_id === glId), (j) => j.owner_entity_id as string, (j) => cents(j, "debit_cents") - cents(j, "credit_cents"));
    const trust = cash("gl-1010"), dep = cash("gl-1020");
    for (const x of b.balances) {
      const oe = x.account_id.split("-")[1];
      expect(x.account_id.endsWith("-trust") ? trust.get(oe) : dep.get(oe), x.account_id).toBe(x.cleared_cents);
    }
  });

  it("management fee is 8% of each rent receipt, from MANAGEMENT_FEE_RATE", () => {
    const fees = new Map(T.transfers.filter((t) => t.kind === "Management fee").map((t) => [t.ref as string, cents(t)]));
    const rent = T.transfers.filter((t) => t.kind === "Rent" && t.status === "Cleared");
    expect(fees.size).toBe(rent.length);
    for (const t of rent) expect(fees.get(t.id as string)).toBe(pctOf(cents(t), Math.round(MANAGEMENT_FEE_RATE * 100)));
  });

  it("owner statements: income − expenses − fee = distribution + reserve", () => {
    const rounding = flagged("owner_distributions.rounding_cent");
    expect(T.owner_distributions.length).toBeGreaterThan(100);
    for (const d of T.owner_distributions) {
      const net = cents(d, "income_cents") - cents(d, "expense_cents") - cents(d, "fee_cents");
      const diff = net - cents(d) - cents(d, "reserve_cents");
      expect(diff, d.id as string).toBe(rounding.has(d.id as string) ? 1 : 0);
      expect(T.transfers.find((t) => t.id === d.transfer_id)?.amount_cents).toBe(d.amount_cents);
    }
  });

  it("the trial balance sums to zero", () => {
    expect(sum(T.journal_entries, (j) => cents(j, "debit_cents"))).toBe(sum(T.journal_entries, (j) => cents(j, "credit_cents")));
  });

  it("metrics_monthly matches the raw aggregates", () => {
    expect(T.metrics_monthly).toHaveLength(30 * 19);
    const charged = group(T.charges, (c) => `${c.property_id}|${c.period}`, cents);
    const collected = group(T.payments, (p) => (p.nsf ? null : `${p.property_id}|${(p.received_on as string).slice(0, 7)}`), cents);
    const types = Object.fromEntries(T.gl_accounts.map((g) => [g.id, g.type]));
    const noi = group(T.journal_entries.filter((j) => types[j.gl_account_id as string] === "Income" || types[j.gl_account_id as string] === "Expense"), (j) => `${j.property_id}|${j.period}`, (j) => cents(j, "credit_cents") - cents(j, "debit_cents"));
    const opened = group(T.work_orders, (w) => `${w.property_id}|${(w.opened_at as string).slice(0, 7)}`, () => 1);
    for (const m of T.metrics_monthly) {
      const k = `${m.property_id}|${m.month}`;
      expect(m.charged_cents, k).toBe(charged.get(k) ?? 0);
      expect(m.collected_cents, k).toBe(collected.get(k) ?? 0);
      expect(m.noi_cents, k).toBe(noi.get(k) ?? 0);
      expect(m.wo_opened, k).toBe(opened.get(k) ?? 0);
      expect(m.occupied as number).toBeLessThanOrEqual(m.units as number);
    }
  });

  it("plants about 4% corrupted records per major entity, in every property's scope", () => {
    const open = T.data_issues.filter((i) => i.status === "open" || i.status === "fixed");
    const rate = (entity: string, rows: number) => open.filter((i) => i.entity_type === entity).length / rows;
    for (const [entity, table] of [["residents", "residents"], ["leases", "leases"], ["units", "units"], ["work_orders", "work_orders"], ["bill_lines", "bills"]] as const) {
      expect(rate(entity, T[table].length), entity).toBeGreaterThan(0.03);
      expect(rate(entity, T[table].length), entity).toBeLessThan(0.08);
    }
    expect(open.filter((i) => i.entity_type === "properties").length).toBeGreaterThanOrEqual(3);
    expect(open.filter((i) => i.entity_type === "vendors").length).toBeGreaterThanOrEqual(2);
    expect(open.filter((i) => i.entity_type === "payments").length).toBeGreaterThanOrEqual(30);
    const props = new Set(open.map((i) => i.property_id));
    for (const p of T.properties) expect(props.has(p.id), p.id as string).toBe(true);
  });

  it("seeds platform usage per org and a change history for policies and state rules", () => {
    expect(new Set(T.org_usage_monthly.map((u) => u.org_id)).size).toBe(5);
    const summit = T.org_usage_monthly.filter((u) => u.org_id === "org-summit");
    expect(summit.reduce((s, u) => s + (u.agent_runs as number), 0)).toBe(T.agent_runs.filter((r) => (r.started_at as string) >= "2025-09").length);
    const changes = T.audit.filter((a) => ["approval_policies", "late_fee_policies", "state_rules"].includes(a.entity_type as string));
    expect(changes.length).toBeGreaterThanOrEqual(12);
    for (const a of changes) expect(a.before_json, a.id as string).not.toBeNull();
    expect(T.help_articles.some((h) => h.id === "state-rules")).toBe(true);
  });

  it("lands in the planned ranges: occupancy, delinquency, open work orders", () => {
    const oct = T.metrics_monthly.filter((m) => m.month === "2026-10");
    const occ = sum(oct, (m) => m.occupied as number) / sum(oct, (m) => m.units as number);
    expect(occ).toBeGreaterThan(0.9);
    expect(occ).toBeLessThan(0.98);
    const late = sum(oct, (m) => cents(m, "aging_0_30_cents") + cents(m, "aging_31_60_cents") + cents(m, "aging_61_90_cents") + cents(m, "aging_90p_cents")) / sum(oct, (m) => cents(m, "gpr_cents"));
    expect(late).toBeGreaterThan(0.02);
    expect(late).toBeLessThan(0.07);
    const open = T.work_orders.filter((w) => !["Completed", "Paid", "Cancelled"].includes(w.status as string));
    expect(open.length).toBeGreaterThan(90);
    expect(open.length).toBeLessThan(260);
    expect(T.legal_cases?.some((c) => c.kind === "Eviction") ?? T.leases.some((l) => l.status === "Eviction")).toBe(true);
  });
});
