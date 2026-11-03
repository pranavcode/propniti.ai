import Link from "next/link";
import { ArrowRight, History, TrendingUp } from "lucide-react";
import type { Row } from "@/entities/types";
import type { TabProps } from "@/extensions/tabs";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { asOfDate, leaseRecord, one, pageCtx, sql } from "../server";

// Terms and schedule: the lease's key terms, the rent schedule with escalations applied (and NNN
// recoveries for commercial leases), recurring charges, and the renewal chain before and after it.

type Step = { from: string; to: string; base: number; nnn: number; note: string; current: boolean };

function schedule(l: NonNullable<Awaited<ReturnType<typeof leaseRecord>>>, today: string): Step[] {
  const nnn = (l.cam_cents ?? 0) + (l.tax_cents ?? 0) + (l.insurance_cents ?? 0);
  const ups = [...l.escalations].sort((a, b) => a.on.localeCompare(b.on));
  // Stored rent is today's rent; walk back through the escalations that already happened.
  let base = l.rent_cents;
  for (const e of [...ups].reverse()) if (e.on <= today) base = e.pct != null ? Math.round(base / (1 + e.pct / 100)) : base - (e.amount_cents ?? 0);
  const steps: Step[] = [];
  let from = l.start_on;
  for (const e of ups) {
    steps.push({ from, to: e.on, base, nnn, note: steps.length ? "" : "Commencement", current: from <= today && today < e.on });
    base = e.pct != null ? Math.round(base * (1 + e.pct / 100)) : base + (e.amount_cents ?? 0);
    from = e.on;
  }
  const end = l.end_on ?? "";
  steps.push({ from, to: end, base, nnn, note: ups.length ? "" : "Full term", current: from <= today && (!end || today <= end) });
  return steps.map((s, i) => ({ ...s, note: s.note || (ups[i - 1]?.pct != null ? `+${ups[i - 1].pct}%` : `+$${((ups[i - 1]?.amount_cents ?? 0) / 100).toFixed(0)}`) }));
}

export async function LeaseTerms({ id }: TabProps) {
  const ctx = await pageCtx();
  const today = await asOfDate(ctx.db);
  const l = await leaseRecord(ctx, id);
  if (!l) return <EmptyState title="Lease not found" />;
  const [charges, chainBack, chainFwd, offers] = await Promise.all([
    sql(ctx, "SELECT label, amount_cents, frequency, start_on, end_on FROM {recurring_charges} WHERE lease_id = ? ORDER BY amount_cents DESC", [id]),
    sql(ctx, `WITH RECURSIVE chain(id, depth) AS (SELECT renewal_of, 1 FROM {leases} WHERE id = ?1 AND renewal_of IS NOT NULL UNION ALL SELECT l.renewal_of, c.depth + 1 FROM {leases} l JOIN chain c ON l.id = c.id WHERE l.renewal_of IS NOT NULL AND c.depth < 10)
      SELECT l.id, l.start_on, l.end_on, l.rent_cents, l.status, l.term_months, c.depth FROM chain c JOIN {leases} l ON l.id = c.id ORDER BY l.start_on`, [id]),
    sql(ctx, "SELECT id, start_on, end_on, rent_cents, status, term_months FROM {leases} WHERE renewal_of = ? ORDER BY start_on", [id]),
    sql(ctx, "SELECT id, version, term_months, rent_cents, current_rent_cents, market_rent_cents, status, sent_at, expires_on FROM {renewal_offers} WHERE lease_id = ? ORDER BY version", [id]),
  ]);
  const meta = await one(ctx, "SELECT status, notice_on, move_in_on, move_out_on FROM {leases} WHERE id = ?", [id]);
  const steps = schedule(l, today);
  const commercial = l.kind === "Commercial";
  const history: Row[] = [...chainBack.map((x) => ({ ...x, rel: "Previous" })), { id: l.id, start_on: l.start_on, end_on: l.end_on, rent_cents: l.rent_cents, status: meta?.status, term_months: l.term_months, rel: "This lease" }, ...chainFwd.map((x) => ({ ...x, rel: "Renewal" }))];

  return (
    <div className="space-y-3">
      <section className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Tenant", l.tenant || "—"],
          ["Premises", /^[A-Za-z]/.test(l.unit) ? l.unit : `${commercial ? "Suite" : "Unit"} ${l.unit}`],
          ["Term", `${l.term_months ?? "—"} months`],
          ["Commencement", formatDate(l.start_on, "always")],
          ["Expiration", l.end_on ? formatDate(l.end_on, "always") : "Month-to-month"],
          ["Notice given", meta?.notice_on ? formatDate(String(meta.notice_on), "always") : "—"],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 bg-card px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{k}</div>
            <div className="mt-0.5 truncate text-[13px] font-medium">{v}</div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border bg-card">
        <header className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><TrendingUp className="size-3.5 text-muted-foreground" />Rent schedule</h3>
          <span className="text-[11.5px] text-muted-foreground">{l.escalations.length ? `${l.escalations.length} scheduled escalation${l.escalations.length === 1 ? "" : "s"}` : "Flat rent for the term"}{commercial ? ` · NNN share ${l.nnn_share_pct ?? 0}%` : ""}</span>
        </header>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b text-left text-[11px] text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">From</th>
              <th className="px-3 py-1.5 font-medium">To</th>
              <th className="px-3 py-1.5 font-medium">Change</th>
              <th className="px-3 py-1.5 text-right font-medium">Base rent / mo</th>
              {commercial && <th className="px-3 py-1.5 text-right font-medium">CAM, tax, insurance / mo</th>}
              {commercial && <th className="px-3 py-1.5 text-right font-medium">Total / mo</th>}
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.from} className={cn("border-b last:border-0", s.current && "bg-primary/[0.05]")}>
                <td className="px-3 py-1.5 tabular-nums">{formatDate(s.from, "always")}{s.current && <StatusBadge value="Current" tone="info" className="ml-2" />}</td>
                <td className="px-3 py-1.5 tabular-nums">{s.to ? formatDate(s.to, "always") : "—"}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{s.note}</td>
                <td className="px-3 py-1.5 text-right"><Money value={s.base} cents /></td>
                {commercial && <td className="px-3 py-1.5 text-right"><Money value={s.nnn} cents /></td>}
                {commercial && <td className="px-3 py-1.5 text-right font-medium"><Money value={s.base + s.nnn} cents /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {commercial && <p className="border-t px-3 py-2 text-[11.5px] text-muted-foreground">NNN amounts are monthly estimates, reconciled against actual operating expenses after year end.</p>}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-3 py-2">
            <h3 className="text-[12.5px] font-semibold">Recurring charges</h3>
            <Link href="?tab=charges_setup" className="inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline">Details<ArrowRight className="size-3" /></Link>
          </header>
          {charges.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No recurring charges on this lease.</p> : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {charges.map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-1.5">{String(c.label)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{String(c.frequency)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{formatDate(String(c.start_on), "always")} – {c.end_on ? formatDate(String(c.end_on), "always") : "open"}</td>
                    <td className="px-3 py-1.5 text-right"><Money value={Number(c.amount_cents)} cents /></td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-medium"><td className="px-3 py-1.5" colSpan={3}>Monthly total</td><td className="px-3 py-1.5 text-right"><Money value={charges.filter((c) => c.frequency === "Monthly").reduce((a, c) => a + Number(c.amount_cents), 0)} cents /></td></tr>
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><History className="size-3.5 text-muted-foreground" />Renewal history</h3>
            <span className="text-[11.5px] text-muted-foreground">{history.length} term{history.length === 1 ? "" : "s"}</span>
          </header>
          <ol className="divide-y">
            {history.map((h, i) => {
              const prev = history[i - 1];
              const change = prev ? (Number(h.rent_cents) - Number(prev.rent_cents)) / Number(prev.rent_cents) : null;
              return (
                <li key={String(h.id)} className={cn("flex items-center gap-2 px-3 py-1.5 text-[12.5px]", h.id === l.id && "bg-primary/[0.05]")}>
                  <span className="w-20 shrink-0 text-muted-foreground">{String(h.rel)}</span>
                  {h.id === l.id ? <span className="whitespace-nowrap font-medium">{String(h.id)}</span> : <Link href={`/app/leases/${encodeURIComponent(String(h.id))}?tab=terms`} className="whitespace-nowrap font-medium text-primary hover:underline">{String(h.id)}</Link>}
                  <span className="min-w-0 truncate text-muted-foreground tabular-nums">{formatDate(String(h.start_on), "always")} – {h.end_on ? formatDate(String(h.end_on), "always") : "open"}</span>
                  <span className="ml-auto tabular-nums"><Money value={Number(h.rent_cents)} cents style="whole" /></span>
                  <span className={cn("w-14 text-right text-[11.5px] tabular-nums", change == null ? "text-muted-foreground" : change > 0 ? "text-tone-warning" : "text-tone-success")}>{change == null ? "" : `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`}</span>
                </li>
              );
            })}
          </ol>
          {offers.length > 0 && (
            <div className="border-t px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Renewal offers</div>
              <ul className="mt-1 space-y-1 text-[12.5px]">
                {offers.map((o) => (
                  <li key={String(o.id)} className="flex items-center gap-2">
                    <span>v{String(o.version)} · {String(o.term_months)} mo at <Money value={Number(o.rent_cents)} cents style="whole" /></span>
                    <StatusBadge value={o.status} />
                    <span className="ml-auto text-muted-foreground">{o.expires_on ? `expires ${formatDate(String(o.expires_on))}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
