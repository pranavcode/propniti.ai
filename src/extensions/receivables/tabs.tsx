import Link from "next/link";
import { currentSession } from "@/auth/session";
import { can } from "@/entities";
import { registerTab, type TabProps } from "@/extensions/tabs";
import { EmptyState } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { AS_OF } from "@/seed/constants";
import { effective, type QueryCtx } from "@/server/query";
import { depositRow } from "./money";
import { leaseLedger, leasesOfHousehold } from "./queries";
import { DispositionForm, type DispositionCharge } from "./ui/Disposition";
import { LedgerView } from "./ui/LedgerView";
import { WrongLeaseFix, type WrongLeaseIssue } from "./ui/WrongLeaseFix";

// Tabs get the row and actor but not the workspace; it comes from the same session cookie.
async function sessionCtx(p: TabProps): Promise<QueryCtx> {
  return { db: getPlatform().db, ws: (await currentSession()).ws, actor: p.actor };
}

async function leaseIdOf(ctx: QueryCtx, p: TabProps): Promise<string | null> {
  if (p.entity === "leases") return p.id;
  if (typeof p.row.lease_id === "string") return p.row.lease_id;
  if (p.entity === "residents" && typeof p.row.household_id === "string") return (await leasesOfHousehold(ctx, p.row.household_id))[0]?.id ?? null;
  return null;
}

registerTab({
  key: "receivables.ledger",
  label: "Ledger",
  entity: "leases",
  roles: ["principal", "regional_manager", "property_manager", "accountant", "resident", "owner"],
  async component(p) {
    const ctx = await sessionCtx(p);
    const leaseId = await leaseIdOf(ctx, p);
    if (!leaseId) return <EmptyState compact kind="table" title="No lease on file" description="A ledger appears once this household has a lease." />;
    return (
      <div className="flex flex-col gap-2">
        <LedgerView ctx={ctx} leaseId={leaseId} highlight={p.entity === "leases" || p.entity === "residents" ? undefined : p.id} switchHref={p.entity === "residents" ? (id) => `/app/receivables/ledger/${id}` : undefined} />
        <Link href={`/app/receivables/ledger/${leaseId}`} className="self-start text-[12.5px] text-primary hover:underline">Open full-page ledger →</Link>
      </div>
    );
  },
});

registerTab({
  key: "receivables.disposition",
  label: "Disposition",
  entity: "deposits",
  roles: ["principal", "regional_manager", "property_manager", "accountant"],
  async component(p) {
    const ctx = await sessionCtx(p);
    const d = await depositRow({ db: ctx.db, ws: ctx.ws ?? "~" }, p.id);
    if (!d) return <EmptyState compact title="Deposit not found" />;
    const sent = await ctx.db
      .prepare(`SELECT x.deductions, x.refund_cents, x.sent_on, x.status, x.due_on FROM ${effective("deposit_dispositions", ctx.ws)} AS x WHERE x.deposit_id = ?`)
      .bind(p.id)
      .first<{ deductions: string; refund_cents: number; sent_on: string | null; status: string; due_on: string }>();
    const { rows } = await leaseLedger(ctx, d.lease_id);
    const openCharges: DispositionCharge[] = rows.filter((r) => r.kind === "charge" && (r.open ?? 0) > 0).map((r) => ({ id: r.id, description: r.description, due_on: r.date, open: (r.open ?? 0) / 100 }));
    const deductions = (() => {
      try {
        return (JSON.parse(sent?.deductions ?? "[]") as { label: string; amount_cents: number }[]).map((x) => ({ label: x.label, amount: x.amount_cents / 100 }));
      } catch {
        return [];
      }
    })();
    return (
      <DispositionForm
        depositId={d.id}
        amount={d.amount_cents / 100}
        leaseId={d.lease_id}
        household={d.household_name}
        moveOut={d.move_out_on}
        dueOn={sent?.due_on ?? d.due_on}
        asOf={AS_OF}
        state={d.state}
        settled={d.status === "Settled" ? { sentOn: sent?.sent_on ?? null, status: sent?.status ?? "Sent", refund: (sent?.refund_cents ?? 0) / 100, deductions } : null}
        openCharges={openCharges}
        canSend={can(p.actor.role, "deposits.send_disposition", "deposits")}
      />
    );
  },
});

registerTab({
  key: "receivables.payment_health",
  label: "Data health",
  entity: "payments",
  roles: ["principal", "regional_manager", "property_manager", "accountant"],
  async component(p) {
    const ctx = await sessionCtx(p);
    const issue = await ctx.db
      .prepare(`SELECT i.id, i.evidence, i.suggested_fix, i.status, i.severity, i.detected_at FROM ${effective("data_issues", ctx.ws)} AS i WHERE i.entity_type = 'payments' AND i.entity_id = ? AND i.rule_id = 'payments.wrong_lease' ORDER BY i.detected_at DESC LIMIT 1`)
      .bind(p.id)
      .first<{ id: string; evidence: string; suggested_fix: string | null; status: string; severity: string; detected_at: string }>();
    if (!issue) return <EmptyState compact kind="table" title="No data issues on this payment" description="Data Health checks every payment against the lease and charge it's posted to." />;
    const fix = parse<{ params?: { to_charge_id?: string }; why?: string[]; confidence?: number; source?: string }>(issue.suggested_fix, {});
    const evidence = parse<Record<string, unknown>>(issue.evidence, {});
    const target = fix.params?.to_charge_id
      ? await ctx.db.prepare(`SELECT c.id, c.lease_id, c.description, c.due_on, c.amount_cents, (SELECT h.name FROM ${effective("households", ctx.ws)} h WHERE h.id = c.household_id) AS household FROM ${effective("charges", ctx.ws)} AS c WHERE c.id = ?`).bind(fix.params.to_charge_id).first<{ id: string; lease_id: string; description: string; due_on: string; amount_cents: number; household: string }>()
      : null;
    const data: WrongLeaseIssue = {
      id: issue.id, status: issue.status, paymentId: p.id, amount: Number(p.row.amount ?? 0),
      from: { lease: String(p.row.lease_id ?? ""), label: String(p.row.lease_id__label ?? p.row.lease_id ?? ""), charge: (p.row.charge_id as string) ?? null },
      to: target ? { lease: target.lease_id, charge: target.id, description: target.description, household: target.household, due_on: target.due_on } : null,
      why: fix.why ?? [`Rule payments.wrong_lease flagged this payment`, ...Object.entries(evidence).map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)],
      confidence: fix.confidence ?? 0.8, source: fix.source ?? "rule",
      canApprove: can(p.actor.role, "payments.move_to_lease", "payments"),
    };
    return <WrongLeaseFix issue={data} />;
  },
});

function parse<T>(v: unknown, fallback: T): T {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
