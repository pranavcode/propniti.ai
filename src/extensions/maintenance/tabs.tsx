import Link from "@/components/Link";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FileText, HelpCircle, Sparkles, XCircle } from "lucide-react";
import type { Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { AIBadge } from "@/components/app/ai";
import { registerTab } from "../tabs";
import { SAMPLE_PHOTOS } from "./actions";
import { invoiceInputs, policyFor } from "./queries";
import { PHOTO_TAGS, photoTag, policyCheck, upcoming, usd, validateInvoice } from "./rules";
import { all, effective, parse } from "./store";
import { ActionButton, Section } from "./ui/client";
import { AddCost, AddPhoto, ConditionSelect, KeyCheckout, RaiseWorkOrder, StepToggle } from "./ui/controls";
import { ApprovePay, InvoiceEntry } from "./ui/InvoicePanel";

// Custom record tabs for the maintenance module (registered by key, referenced from the defs).

async function ctx() {
  const s = await currentSession();
  return { db: getPlatform().db, ws: s.ws, role: s.actor.role, name: s.actor.name };
}
const WRITERS = new Set(["principal", "regional_manager", "property_manager", "maintenance_supervisor"]);
const pctText = (c: unknown) => `${Math.round(Number(c ?? 0) * 100)}%`;

const CHECK_ICON = { Matches: CheckCircle2, Mismatch: XCircle, Unclear: HelpCircle } as const;
const CHECK_TONE = { Matches: "text-tone-success", Mismatch: "text-tone-danger", Unclear: "text-tone-warning" } as const;

export function PhotoCheckBadge({ result, confidence, note }: { result: string | null; confidence: number | null; note?: string | null }) {
  if (!result) return <span className="text-[11.5px] text-muted-foreground">Not checked</span>;
  const Icon = CHECK_ICON[result as keyof typeof CHECK_ICON] ?? HelpCircle;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11.5px] font-medium", CHECK_TONE[result as keyof typeof CHECK_TONE])} title={note ?? undefined}>
      <Icon className="size-3.5" />{result} · {pctText(confidence)}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = { Status: "Status", Assigned: "Dispatched", Note: "Note", Submission: "Invoice received", Validation: "Invoice checked", Approval: "Approval", Time: "Time logged" };

registerTab({
  key: "maintenance.wo_timeline",
  label: "Timeline",
  entity: "work_orders",
  component: async ({ id }) => {
    const { db, ws } = await ctx();
    const events = await all<Row>(db,
      `SELECT e.*, coalesce(st.name, v.company, e.actor_id) AS who FROM ${effective("wo_events", ws)} e LEFT JOIN ${effective("staff", ws)} st ON st.id = e.actor_id LEFT JOIN ${effective("vendors", ws)} v ON v.id = e.actor_id
       WHERE e.work_order_id = ? ORDER BY e.at DESC, e.seq DESC LIMIT 100`, [id]);
    if (!events.length) return <EmptyState compact kind="table" title="No updates yet" description="Dispatches, status changes, time, invoices and approvals show here as they happen." />;
    const minutes = events.filter((e) => e.kind === "Time").reduce((a, e) => a + Number(parse<{ minutes?: number }>(e.detail, {}).minutes ?? 0), 0);
    return (
      <div className="flex flex-col gap-3">
        {minutes > 0 && <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Clock className="size-3.5" />{Math.floor(minutes / 60)} h {minutes % 60} min logged on this job</p>}
        <ol className="relative border-l pl-4">
          {events.map((e) => {
            const d = parse<Record<string, unknown>>(e.detail, {});
            const agent = e.actor_kind === "agent";
            let text = "";
            if (e.kind === "Status") text = `Moved to ${e.status}${d.note ? `: ${d.note}` : ""}`;
            else if (e.kind === "Assigned") text = `${d.priority ? `${d.priority} · ${d.category} · ` : ""}${d.estimate_cents ? `estimate ${usd(Number(d.estimate_cents))}` : "assigned"}${d.policy ? `. ${d.policy}` : ""}`;
            else if (e.kind === "Submission") text = `${d.invoice_number ? `Invoice ${d.invoice_number}, ` : ""}${usd(Number(d.total_cents ?? 0))}${d.source === "read" ? " (read from the file)" : ""}`;
            else if (e.kind === "Validation") text = `${String(d.summary ?? "")}${d.override ? ` Paid anyway: "${d.override}"` : ""}`;
            else if (e.kind === "Approval") text = d.requested_from === "owner" ? `Sent to the owner to approve ${usd(Number(d.amount_cents ?? 0))}` : `Approved, ${usd(Number(d.amount_cents ?? 0))} paid by ACH`;
            else if (e.kind === "Time") text = `${d.minutes} min${d.note ? `: ${d.note}` : ""}`;
            else text = String(d.note ?? d.text ?? "");
            return (
              <li key={String(e.id)} className="relative pb-3">
                <span className={cn("absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-background", agent ? "bg-tone-ai" : e.kind === "Approval" ? "bg-tone-success" : e.kind === "Validation" && d.decision === "review" ? "bg-tone-warning" : "bg-muted-foreground/50")} />
                <p className="text-[13px]"><span className="font-medium">{EVENT_LABEL[String(e.kind)] ?? String(e.kind)}</span>{e.status && e.kind !== "Status" ? <StatusBadge value={e.status} className="ml-1.5" /> : null}{agent && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-tone-ai"><Sparkles className="size-3" />Agent</span>}</p>
                {text && <p className="text-[12.5px] text-muted-foreground">{text}</p>}
                <p className="text-[11.5px] text-muted-foreground/80">{String(e.who ?? "")} · {formatDateTime(String(e.at))}</p>
              </li>
            );
          })}
        </ol>
      </div>
    );
  },
});

registerTab({
  key: "maintenance.wo_photos",
  label: "Photos",
  entity: "work_orders",
  component: async ({ id, row }) => {
    const { db, ws, role } = await ctx();
    const photos = await all<Row>(db, `SELECT * FROM ${effective("photos", ws)} p WHERE p.entity_type = 'work_orders' AND p.entity_id = ? ORDER BY p.taken_at LIMIT 40`, [id]);
    const canWrite = WRITERS.has(role);
    const flagged = photos.filter((p) => p.check_result && p.check_result !== "Matches").length;
    return (
      <Section
        title={<span className="flex items-center gap-2">Photos <span className="font-normal text-muted-foreground tabular-nums">{photos.length}</span>{flagged > 0 && <StatusBadge value={`${flagged} flagged`} tone="warning" />}</span>}
        aside={canWrite && <div className="flex gap-2">{photos.length > 0 && <ActionButton entity="work_orders" id={id} action="work_orders.check_photos" label="Re-run photo check" />}<AddPhoto woId={id} photos={SAMPLE_PHOTOS.map((url) => ({ url, label: PHOTO_TAGS[photoTag(url)!].label }))} /></div>}
      >
        {photos.length ? (
          <>
            <ul className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3">
              {photos.map((p) => (
                <li key={String(p.id)} className="overflow-hidden rounded-md border">
                  <a href={String(p.url)} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public */}
                    <img src={String(p.url).replace(/(?<!-400)\.webp$/, "-400.webp")} alt={String(p.caption || "Work order photo")} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  </a>
                  <div className="flex flex-col gap-1 p-2">
                    <p className="flex items-center justify-between gap-2 text-[12.5px]"><span className="truncate font-medium">{String(p.caption || "Photo")}</span><StatusBadge value={p.stage ?? "Photo"} tone="neutral" dot={false} /></p>
                    <PhotoCheckBadge result={p.check_result as string | null} confidence={p.check_confidence as number | null} note={p.check_note as string | null} />
                    {p.check_note ? <p className="text-[11.5px] leading-snug text-muted-foreground">{String(p.check_note)}</p> : null}
                    <p className="text-[11px] text-muted-foreground/80">{p.taken_at ? formatDateTime(String(p.taken_at)) : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-1.5 border-t px-3 py-2 text-[11.5px] text-muted-foreground"><AIBadge source="rules" size="xs" />Only photos on file before the vendor&apos;s invoice count toward its photo requirement. The photo check compares what each photo shows with the job&apos;s trade and title ({String(row.category)}). Anything below a match goes to a person.</p>
          </>
        ) : (
          <EmptyState compact kind="table" title="No photos yet" description="Add a before photo so the vendor knows what they're walking into. Each photo is checked against the job." />
        )}
      </Section>
    );
  },
});

registerTab({
  key: "maintenance.wo_invoice",
  label: "Invoice and PO",
  entity: "work_orders",
  roles: ["principal", "regional_manager", "property_manager", "maintenance_supervisor", "accountant"],
  component: async ({ id, row }) => {
    const { db, ws, role } = await ctx();
    const [{ po, submission, photos }, pol, paid, hold] = await Promise.all([
      invoiceInputs(db, ws, id),
      policyFor(db, ws, String(row.property_id)),
      db.prepare(`SELECT t.amount_cents, t.status, t.created FROM ${effective("transfers", ws)} t WHERE t.key = ?`).bind(`vendor:${id}`).first<{ amount_cents: number; status: string; created: string }>(),
      row.vendor_id ? db.prepare(`SELECT 1 AS x FROM ${effective("data_issues", ws)} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = ? AND di.status = 'open'`).bind(row.vendor_id).first() : Promise.resolve(null),
    ]);
    if (!row.vendor_id) return <EmptyState compact kind="table" title="In-house job" description="This job is done by your own technician, so there's no vendor invoice or purchase order. It completes from the technician view." action={{ label: "Open technician view", href: "/app/maintenance/my-jobs" }} />;
    const v = submission ? validateInvoice(po, { lines: submission.lines, total_cents: submission.total_cents, photos }) : null;
    const canWrite = WRITERS.has(role);
    const status = String(row.status);
    const poByGroup = new Map((po?.lines ?? []).map((l) => [l.description.toLowerCase().split(/[\s,:;(-]+/)[0], l.amount_cents]));
    return (
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <Section title={po ? <>Purchase order <Link href={`/app/maintenance/purchase-orders/${po.id}`} className="font-normal text-primary hover:underline">{po.number}</Link></> : "Purchase order"} aside={po && <StatusBadge value={po.status} />}>
            {po ? (
              <table className="w-full text-[13px]">
                <tbody>
                  {po.lines.map((l, i) => <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5">{l.description}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(l.amount_cents / 100)}</td></tr>)}
                </tbody>
                <tfoot><tr className="border-t font-medium"><td className="px-3 py-1.5">PO total</td><td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(po.total_cents / 100)}</td></tr></tfoot>
              </table>
            ) : <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No purchase order was issued for this job, so the invoice is checked for internal consistency only.</p>}
          </Section>
          <Section title={submission ? <>Vendor invoice {submission.invoice_number && <span className="font-normal text-muted-foreground">{submission.invoice_number}</span>}</> : "Vendor invoice"}
            aside={submission && <span className="text-[11.5px] text-muted-foreground">From {submission.source === "read" ? "a file read by AI" : submission.source}{submission.at ? ` · ${formatDate(submission.at)}` : ""}</span>}>
            {submission ? (
              <table className="w-full text-[13px]">
                <tbody>
                  {submission.lines.map((l, i) => {
                    const p = poByGroup.get(l.description.toLowerCase().split(/[\s,:;(-]+/)[0]);
                    const over = p == null || l.amount_cents > p * 1.02;
                    return <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5">{l.description}</td><td className={cn("px-3 py-1.5 text-right tabular-nums", po && over && "font-medium text-tone-danger")}>{formatMoney(l.amount_cents / 100)}</td></tr>;
                  })}
                </tbody>
                <tfoot><tr className="border-t font-medium"><td className="px-3 py-1.5">Invoice total</td><td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(submission.total_cents / 100)}</td></tr></tfoot>
              </table>
            ) : <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No invoice yet. Vendors submit from their portal, or record one here from the paper or emailed invoice.</p>}
          </Section>
        </div>

        {paid ? (
          <div className="flex items-center gap-2 rounded-lg border border-tone-success/30 bg-tone-success/[0.06] px-3 py-2.5 text-[13px]">
            <CheckCircle2 className="size-4 text-tone-success" />Paid {formatMoney(paid.amount_cents / 100)} by ACH on {formatDate(paid.created)} · {paid.status === "Pending" ? "settling" : paid.status.toLowerCase()}. The job is complete.
          </div>
        ) : v ? (
          <Section title={<span className="flex items-center gap-2">PO check <AIBadge source="rules" size="xs" /></span>} aside={<StatusBadge value={v.decision === "approve" ? "Matches PO" : `${v.issues.length} to review`} tone={v.decision === "approve" ? "success" : "warning"} />}>
            <div className="grid gap-3 p-3 md:grid-cols-2">
              <ul className="flex flex-col gap-1 text-[12.5px]">{v.matched.map((m) => <li key={m} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-tone-success" />{m}</li>)}</ul>
              <ul className="flex flex-col gap-1 text-[12.5px]">{v.issues.length ? v.issues.map((m) => <li key={m} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tone-warning" />{m}</li>) : <li className="text-muted-foreground">No issues found.</li>}</ul>
            </div>
            {status === "Submitted" && canWrite && (
              <ApprovePay woId={id} amount={submission!.total_cents / 100} vendor={String(row.vendor_id__label ?? "the vendor")} validation={v} policy={policyCheck(submission!.total_cents, pol)}
                blocked={hold ? `${row.vendor_id__label} changed bank details and isn't verified yet. Payments are on hold until an accountant verifies them.` : policyCheck(submission!.total_cents, pol).level === "owner" ? `${usd(submission!.total_cents)} is over the owner's approval limit. Ask the owner to approve it first.` : undefined} />
            )}
          </Section>
        ) : null}

        {canWrite && !paid && ["Assigned", "Scheduled", "In progress", "On hold", "Submitted"].includes(status) && (
          <Section title={submission ? "Correct the invoice" : "Record the vendor's invoice"} aside={<FileText className="size-4 text-muted-foreground" />}>
            <InvoiceEntry woId={id} initial={submission ?? undefined} poLines={po?.lines ?? []} />
          </Section>
        )}
      </div>
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------------------------

registerTab({
  key: "maintenance.inspection_checklist",
  label: "Checklist",
  entity: "inspections",
  component: async ({ id, row }) => {
    const { db, ws, role } = await ctx();
    const [items, photos] = await Promise.all([
      all<Row>(db, `SELECT i.* FROM ${effective("inspection_items", ws)} i WHERE i.inspection_id = ? ORDER BY i.area, i.seq LIMIT 200`, [id]),
      all<Row>(db, `SELECT p.* FROM ${effective("photos", ws)} p WHERE p.entity_type = 'inspection_items' AND p.entity_id IN (SELECT i.id FROM ${effective("inspection_items", ws)} i WHERE i.inspection_id = ?) LIMIT 40`, [id]),
    ]);
    if (!items.length) return <EmptyState compact kind="table" title="No checklist items" description="This inspection hasn't been started. Items appear by area once the inspector opens it." />;
    const editable = WRITERS.has(role) && row.status !== "Completed";
    const areas = [...new Set(items.map((i) => String(i.area)))];
    const bad = items.filter((i) => ["Damaged", "Missing"].includes(String(i.condition))).length;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-muted-foreground">{items.length} items across {areas.length} areas · {bad ? <span className="text-tone-danger">{bad} damaged or missing</span> : "nothing damaged"}{editable ? ". Changes save as you go." : ""}</p>
        <div className="grid gap-3 lg:grid-cols-2">
          {areas.map((area) => (
            <Section key={area} title={area}>
              <ul className="divide-y">
                {items.filter((i) => i.area === area).map((i) => {
                  const defect = ["Damaged", "Missing"].includes(String(i.condition));
                  const ph = photos.filter((p) => p.entity_id === i.id);
                  return (
                    <li key={String(i.id)} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px]">{String(i.item)}</p>
                        {i.note ? <p className="text-[11.5px] text-muted-foreground">{String(i.note)}</p> : null}
                        {ph.map((p) => <PhotoCheckBadge key={String(p.id)} result={p.check_result as string} confidence={p.check_confidence as number} note={p.check_note as string} />)}
                      </div>
                      {i.work_order_id
                        ? <Link href={`/app/maintenance/work-orders/${i.work_order_id}`} className="text-[12px] text-primary hover:underline">{String(i.work_order_id)}</Link>
                        : defect && editable && <RaiseWorkOrder inspectionId={id} itemId={String(i.id)} />}
                      {editable ? <ConditionSelect inspectionId={id} itemId={String(i.id)} value={String(i.condition)} label={String(i.item)} /> : <StatusBadge value={i.condition} tone={defect ? "danger" : i.condition === "Fair" ? "warning" : i.condition === "Good" ? "success" : "neutral"} />}
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}
        </div>
      </div>
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Preventive schedules
// ---------------------------------------------------------------------------------------------

registerTab({
  key: "maintenance.pm_upcoming",
  label: "Upcoming",
  entity: "pm_schedules",
  component: async ({ id, row }) => {
    const { db, ws, role } = await ctx();
    const dates = upcoming(String(row.next_due_on), String(row.frequency), 6);
    const steps = parse<string[]>(row.checklist, []);
    const history = await all<Row>(db, `SELECT w.id, w.status, w.opened_at, w.completed_at, w.cost_cents FROM ${effective("work_orders", ws)} w WHERE w.pm_schedule_id = ? ORDER BY w.opened_at DESC LIMIT 6`, [id]);
    return (
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Section title="Next six occurrences" aside={WRITERS.has(role) && row.active ? <ActionButton entity="pm_schedules" id={id} action="pm_schedules.generate" label={`Create work order for ${formatDate(dates[0])}`} variant="default" follow /> : undefined}>
          <ol className="divide-y">
            {dates.map((d, i) => (
              <li key={d} className="flex items-center justify-between px-3 py-2 text-[13px]">
                <span className="flex items-center gap-2">{i === 0 ? <CircleDashed className="size-4 text-primary" /> : <span className="size-4" />}{formatDate(d, "always")}</span>
                <span className="text-[12px] text-muted-foreground">{i === 0 ? "Next: becomes a work order" : `${String(row.frequency).toLowerCase()} after the previous`}</span>
              </li>
            ))}
          </ol>
        </Section>
        <div className="flex flex-col gap-3">
          <Section title="Checklist the technician follows">
            {steps.length ? <ol className="list-decimal flex flex-col gap-1 py-2 pr-3 pl-8 text-[13px]">{steps.map((s) => <li key={s}>{s}</li>)}</ol> : <p className="px-3 py-2 text-[12.5px] text-muted-foreground">No checklist steps on this schedule.</p>}
          </Section>
          <Section title="Recent work orders">
            {history.length ? (
              <ul className="divide-y">{history.map((w) => (
                <li key={String(w.id)} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <Link href={`/app/maintenance/work-orders/${w.id}`} className="font-medium hover:text-primary hover:underline">{String(w.id)}</Link>
                  <span className="text-muted-foreground">{formatDate(String(w.opened_at))}</span>
                  <StatusBadge value={w.status} />
                </li>
              ))}</ul>
            ) : <p className="px-3 py-2 text-[12.5px] text-muted-foreground">None generated yet.</p>}
          </Section>
        </div>
      </div>
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Turnovers
// ---------------------------------------------------------------------------------------------

registerTab({
  key: "maintenance.make_ready",
  label: "Make-ready",
  entity: "turnovers",
  component: async ({ id, row }) => {
    const { db, ws, role } = await ctx();
    const [raw, wos, costs, bench] = await Promise.all([
      db.prepare(`SELECT checklist, cost_cents FROM ${effective("turnovers", ws)} WHERE id = ?`).bind(id).first<{ checklist: string; cost_cents: number }>(),
      all<Row>(db, `SELECT w.id, w.title, w.status, coalesce(w.cost_cents, w.estimate_cents, 0) AS cents, w.cost_cents IS NULL AS estimated FROM ${effective("work_orders", ws)} w WHERE w.turnover_id = ? ORDER BY w.opened_at LIMIT 20`, [id]),
      all<Row>(db, `SELECT a.summary, a.at, a.actor_id FROM ${effective("activity_events", ws)} a WHERE a.entity_type = 'turnovers' AND a.entity_id = ? AND a.verb = 'cost_added' ORDER BY a.at DESC LIMIT 20`, [id]),
      db.prepare(`SELECT avg(t.cost_cents) AS avg, count(*) AS n FROM ${effective("turnovers", ws)} t WHERE t.property_id = ? AND t.status IN ('Ready', 'Leased') AND t.cost_cents > 0`).bind(row.property_id).first<{ avg: number | null; n: number }>(),
    ]);
    const steps = parse<{ step: string; done: boolean; by: string | null }[]>(raw?.checklist, []);
    const done = steps.filter((s) => s.done).length;
    const editable = WRITERS.has(role) && ["Not started", "In progress"].includes(String(row.status));
    const direct = Number(raw?.cost_cents ?? 0);
    const woCents = wos.reduce((a, w) => a + Number(w.cents), 0);
    const total = direct + woCents;
    const avg = bench?.avg ? Math.round(bench.avg) : null;
    return (
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Section title={<>Checklist <span className="font-normal text-muted-foreground tabular-nums">{done} of {steps.length}</span></>}
          aside={editable && <ActionButton entity="turnovers" id={id} action="turnovers.mark_ready" label="Mark rent-ready" variant={done === steps.length ? "default" : "outline"} disabled={done !== steps.length} />}>
          <div className="h-1 bg-muted"><div className="h-1 bg-primary transition-[width] duration-200" style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} /></div>
          <div className="divide-y">{steps.map((s, i) => <StepToggle key={s.step} turnoverId={id} index={i} done={s.done} step={s.step} by={s.by} disabled={!editable} />)}</div>
        </Section>
        <Section title="Cost" aside={<span className="text-[13px] font-semibold tabular-nums">{formatMoney(total / 100)}</span>}>
          <dl className="grid grid-cols-3 gap-px border-b bg-border text-[12px]">
            <div className="bg-card px-3 py-2"><dt className="text-muted-foreground">Recorded here</dt><dd className="text-[13.5px] font-medium tabular-nums">{formatMoney(direct / 100)}</dd></div>
            <div className="bg-card px-3 py-2"><dt className="text-muted-foreground">Work orders</dt><dd className="text-[13.5px] font-medium tabular-nums">{formatMoney(woCents / 100)}</dd></div>
            <div className="bg-card px-3 py-2"><dt className="text-muted-foreground">Property average</dt><dd className={cn("text-[13.5px] font-medium tabular-nums", avg != null && total > avg * 1.25 && "text-tone-danger")}>{avg != null ? formatMoney(avg / 100) : "—"}</dd></div>
          </dl>
          {avg != null && total > avg * 1.25 && <p className="border-b px-3 py-2 text-[12px] text-tone-danger">{Math.round((total / avg - 1) * 100)}% above the average of {bench!.n} finished turns at this property.</p>}
          <ul className="divide-y">
            {wos.map((w) => (
              <li key={String(w.id)} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                <Link href={`/app/maintenance/work-orders/${w.id}`} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{String(w.title)}</Link>
                <StatusBadge value={w.status} />
                <span className="w-24 text-right tabular-nums">{formatMoney(Number(w.cents) / 100)}{w.estimated ? <span className="text-muted-foreground"> est.</span> : null}</span>
              </li>
            ))}
            {costs.map((c, i) => <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-[13px]"><span className="min-w-0 flex-1 truncate">{String(c.summary)}</span><span className="text-[11.5px] text-muted-foreground">{formatDate(String(c.at))}</span></li>)}
            {!wos.length && !costs.length && <li className="px-3 py-2 text-[12.5px] text-muted-foreground">No costs recorded yet.</li>}
          </ul>
          {WRITERS.has(role) && row.status !== "Leased" && <div className="border-t"><AddCost turnoverId={id} /></div>}
        </Section>
      </div>
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Purchase orders and keys
// ---------------------------------------------------------------------------------------------

registerTab({
  key: "maintenance.po_lines",
  label: "Lines and billing",
  entity: "purchase_orders",
  component: async ({ id, row }) => {
    const { db, ws } = await ctx();
    const [lines, bills] = await Promise.all([
      all<Row>(db, `SELECT l.*, g.name AS gl FROM ${effective("po_lines", ws)} l LEFT JOIN ${effective("gl_accounts", ws)} g ON g.id = l.gl_account_id WHERE l.po_id = ? ORDER BY l.id LIMIT 50`, [id]),
      all<Row>(db, `SELECT b.id, b.invoice_number, b.bill_date, b.amount_cents, b.status FROM ${effective("bills", ws)} b WHERE b.po_id = ? OR (b.work_order_id IS NOT NULL AND b.work_order_id = ?) ORDER BY b.bill_date LIMIT 20`, [id, row.work_order_id ?? ""]),
    ]);
    const total = Number(row.total ?? 0);
    const billed = bills.reduce((a, b) => a + Number(b.amount_cents), 0) / 100;
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Lines">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b text-left text-[11.5px] text-muted-foreground"><th className="px-3 py-1.5 font-normal">Description</th><th className="px-3 py-1.5 font-normal">GL account</th><th className="px-3 py-1.5 text-right font-normal">Amount</th></tr></thead>
            <tbody>{lines.map((l) => <tr key={String(l.id)} className="border-b last:border-0"><td className="px-3 py-1.5">{String(l.description)}</td><td className="px-3 py-1.5 text-muted-foreground">{String(l.gl ?? l.gl_account_id)}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(Number(l.amount_cents) / 100)}</td></tr>)}</tbody>
            <tfoot><tr className="font-medium"><td className="px-3 py-1.5" colSpan={2}>PO total</td><td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(total)}</td></tr></tfoot>
          </table>
        </Section>
        <Section title="Billed against this PO" aside={<span className={cn("text-[12.5px] tabular-nums", billed > total * 1.02 && "font-medium text-tone-danger")}>{formatMoney(billed)} of {formatMoney(total)}</span>}>
          {bills.length ? (
            <ul className="divide-y">{bills.map((b) => (
              <li key={String(b.id)} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                <Link href={`/app/payables/bills/${b.id}`} className="font-medium hover:text-primary hover:underline">{String(b.invoice_number)}</Link>
                <span className="text-muted-foreground">{formatDate(String(b.bill_date))}</span>
                <span className="flex-1" /><StatusBadge value={b.status} /><span className="w-24 text-right tabular-nums">{formatMoney(Number(b.amount_cents) / 100)}</span>
              </li>
            ))}</ul>
          ) : <p className="px-3 py-2 text-[12.5px] text-muted-foreground">No bills yet. The vendor&apos;s invoice is checked against these lines when it arrives.</p>}
        </Section>
      </div>
    );
  },
});

registerTab({
  key: "maintenance.key_log",
  label: "Access log",
  entity: "keys",
  component: async ({ id, row }) => {
    const { db, ws, role } = await ctx();
    const [log, staff, vendors] = await Promise.all([
      all<Row>(db,
        `SELECT l.*, CASE l.holder_kind WHEN 'staff' THEN (SELECT s.name FROM ${effective("staff", ws)} s WHERE s.id = l.holder_id) WHEN 'vendor' THEN (SELECT v.company FROM ${effective("vendors", ws)} v WHERE v.id = l.holder_id) END AS holder
         FROM ${effective("key_log", ws)} l WHERE l.key_id = ? ORDER BY l.at DESC LIMIT 50`, [id]),
      row.state === "In key box" ? all<{ id: string; name: string }>(db, `SELECT s.id, s.name FROM ${effective("staff", ws)} s WHERE s.active = 1 ORDER BY s.name LIMIT 200`) : Promise.resolve([]),
      row.state === "In key box" ? all<{ id: string; company: string }>(db, `SELECT v.id, v.company FROM ${effective("vendors", ws)} v WHERE v.status = 'Active' ORDER BY v.company LIMIT 200`) : Promise.resolve([]),
    ]);
    return (
      <div className="flex flex-col gap-3">
        {row.state === "In key box" && WRITERS.has(role) && (
          <Section title="Check out this key"><KeyCheckout keyId={id} people={[...staff.map((s) => ({ kind: "staff" as const, id: s.id, name: s.name })), ...vendors.map((v) => ({ kind: "vendor" as const, id: v.id, name: v.company }))]} /></Section>
        )}
        <Section title="History">
          {log.length ? (
            <ol className="divide-y">{log.map((l) => (
              <li key={String(l.id)} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                <StatusBadge value={l.action} tone={l.action === "Lost" ? "danger" : l.action === "Returned" ? "success" : "info"} />
                <span className="flex-1">{l.holder ? String(l.holder) : "Key box"}{l.work_order_id ? <> · <Link href={`/app/maintenance/work-orders/${l.work_order_id}`} className="text-primary hover:underline">{String(l.work_order_id)}</Link></> : null}</span>
                <span className="text-[12px] text-muted-foreground">{formatDateTime(String(l.at))}</span>
              </li>
            ))}</ol>
          ) : <p className="px-3 py-2 text-[12.5px] text-muted-foreground">This key hasn&apos;t left the key box.</p>}
        </Section>
      </div>
    );
  },
});
