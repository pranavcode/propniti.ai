import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { currentSession } from "@/auth/session";
import { can } from "@/entities/registry";
import { getPlatform } from "@/lib/platform";
import { effective } from "@/server/query";
import { Money, RelativeDate, StatusBadge } from "@/components/app/display";
import { registerTab, type TabProps } from "../../tabs";
import { threshold1099 } from "../tax";
import { BankForms } from "./BankForms";

// "Payments and bank" tab on the vendor record (finance view): bank status and the guarded change
// and verify forms, money paid by year, open bills, and the latest payments.
async function VendorFinance({ id, row, actor }: TabProps) {
  const { db } = getPlatform();
  const { ws } = await currentSession();
  const today = (await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? "2026-11-04";
  const [hold, years, payments, open] = await Promise.all([
    db.prepare(`SELECT di.id, di.evidence, di.detected_at FROM ${effective("data_issues", ws)} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ? AND di.status = 'open' ORDER BY di.detected_at DESC LIMIT 1`).bind(id).first<{ id: string; evidence: string; detected_at: string }>(),
    db.prepare(`SELECT substr(t.created, 1, 4) AS year, sum(t.amount_cents) AS cents, count(*) AS n FROM ${effective("transfers", ws)} t WHERE t.kind = 'Vendor payout' AND t.to_id = ? AND t.status <> 'Returned' GROUP BY year ORDER BY year DESC`).bind(id).all<{ year: string; cents: number; n: number }>(),
    db.prepare(`SELECT t.id, t.ref, t.amount_cents, t.status, t.created, t.property_id FROM ${effective("transfers", ws)} t WHERE t.kind = 'Vendor payout' AND t.to_id = ? ORDER BY t.created DESC LIMIT 10`).bind(id).all<{ id: string; ref: string; amount_cents: number; status: string; created: string; property_id: string }>(),
    db.prepare(`SELECT count(*) AS n, coalesce(sum(b.amount_cents), 0) AS c FROM ${effective("bills", ws)} b WHERE b.vendor_id = ? AND b.status IN ('Draft', 'Pending approval', 'Approved')`).bind(id).first<{ n: number; c: number }>(),
  ]);
  const changedAt = row.bank_changed_at ? String(row.bank_changed_at) : null;
  const recent = changedAt && (Date.parse(today) - Date.parse(changedAt.slice(0, 10))) / 86_400_000 <= 60;
  const evidence = (() => { try { return hold ? JSON.parse(hold.evidence) as { changed_by?: string; received_via?: string; requested_by?: string; old_last4?: string; new_last4?: string } : null; } catch { return null; } })();
  const held = !!hold || (!!recent && !(await db.prepare(`SELECT 1 FROM ${effective("data_issues", ws)} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ? AND di.status = 'fixed' AND di.fixed_at >= ?`).bind(id, changedAt).first()));
  const year = Number(today.slice(0, 4));

  return (
    <div className="space-y-4">
      <section className={held ? "rounded-lg border border-tone-danger/30 bg-tone-danger/[0.05] p-3" : "rounded-lg border bg-card p-3"}>
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">{held && <ShieldAlert className="size-4 text-tone-danger" />}Bank account {row.bank_last4 ? <span className="font-normal tabular-nums text-muted-foreground">ending {String(row.bank_last4)}</span> : null}</h3>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {held
            ? <>Changed {changedAt?.slice(0, 10)}{evidence?.received_via ? ` by ${evidence.received_via.toLowerCase()}` : ""}{evidence?.requested_by ? ` (requested by ${evidence.requested_by})` : ""}{evidence?.old_last4 ? `; previously ending ${evidence.old_last4}` : ""}. Payments are on hold until someone verifies the change by callback.</>
            : changedAt ? <>Last changed {changedAt.slice(0, 10)}, verified.</> : "No changes on record."}
        </p>
        <div className="mt-3">
          <BankForms vendor={id} company={String(row.company ?? id)} held={held} canChange={can(actor.role, "vendors.change_bank_account", "vendors")} canVerify={can(actor.role, "vendors.confirm_bank_change", "vendors")} changedByMe={evidence?.changed_by === actor.personaId} />
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <section className="rounded-lg border bg-card p-3">
          <h3 className="text-[12px] text-muted-foreground">Open bills</h3>
          <Link href={`/app/payables/bills?f.vendor_id=${id}&f.status=Draft,Pending%20approval,Approved`} className="mt-1 block text-[18px] font-semibold tabular-nums hover:text-primary"><Money value={open?.c ?? 0} cents /> <span className="text-[12.5px] font-normal text-muted-foreground">({open?.n ?? 0})</span></Link>
        </section>
        <section className="rounded-lg border bg-card p-3 md:col-span-2">
          <h3 className="text-[12px] text-muted-foreground">Paid by year (1099-NEC threshold ${threshold1099(year).toLocaleString("en-US")} for {year})</h3>
          <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            {years.results.map((y) => <div key={y.year}><dt className="text-[11.5px] text-muted-foreground">{y.year}</dt><dd className="text-[14px] font-medium tabular-nums"><Money value={y.cents} cents /> <span className="text-[12px] font-normal text-muted-foreground">· {y.n} payments</span></dd></div>)}
            {!years.results.length && <dd className="text-[12.5px] text-muted-foreground">No payments yet.</dd>}
          </dl>
          {row.is_1099 ? <Link href={`/app/finance/1099?year=${year}`} className="mt-1 inline-block text-[12px] text-primary hover:underline">1099 preparation</Link> : <p className="mt-1 text-[12px] text-muted-foreground">Not a 1099 vendor.</p>}
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border bg-card">
        <h3 className="border-b px-3 py-2 text-[13px] font-semibold">Latest payments</h3>
        {payments.results.length ? (
          <table className="w-full text-[13px]">
            <thead className="text-[12px] text-muted-foreground">
              <tr className="border-b"><th className="px-3 py-1.5 text-left font-medium">Bill</th><th className="px-3 py-1.5 text-left font-medium">Sent</th><th className="px-3 py-1.5 text-left font-medium">Status</th><th className="px-3 py-1.5 text-right font-medium">Amount</th></tr>
            </thead>
            <tbody>
              {payments.results.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{p.ref.startsWith("BILL-") ? <Link href={`/app/payables/bills/${p.ref}`} className="hover:underline">{p.ref}</Link> : p.ref}</td>
                  <td className="px-3 py-1.5"><RelativeDate value={p.created} mode="date" /></td>
                  <td className="px-3 py-1.5"><StatusBadge value={p.status} /></td>
                  <td className="px-3 py-1.5 text-right"><Money value={p.amount_cents} cents /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-3 py-2 text-[12.5px] text-muted-foreground">No payments yet.</p>}
      </section>
    </div>
  );
}

registerTab({ key: "payables.vendor_finance", label: "Payments and bank", entity: "vendors", roles: ["principal", "regional_manager", "accountant"], component: VendorFinance });
