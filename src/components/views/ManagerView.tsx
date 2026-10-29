"use client";

import Link from "next/link";
import { useState } from "react";
import { money } from "@/lib/mockAi";
import { MANAGEMENT_FEE_RATE, ownerStatement, trustBalance } from "@/lib/ledger";
import { lowRatings, ratingSummary } from "@/lib/ratings";
import { useDemo } from "@/lib/store";
import { isDoneWorkOrder, isOpenWorkOrder, propName, submissionKey, userName, vendorName } from "@/lib/names";
import type { AskResult, DemoState, RatingSubject, ValidationResult, WorkOrder } from "@/lib/types";
import { InvoiceUpload } from "../InvoiceUpload";
import { RateBox, RatingBadge, Stars } from "../Ratings";
import { Shell } from "../Shell";
import { Badge, Button, Card, SourceNote, Stat, Table, ValidationCard, statusTone } from "../ui";

export function ManagerView() {
  const [tab, setTab] = useState("dashboard");
  const [selectedWo, setSelectedWo] = useState("WO-1041");
  const openWo = (id: string) => {
    setSelectedWo(id);
    setTab("work-orders");
  };
  return (
    <Shell
      persona="pm"
      tab={tab}
      onTab={setTab}
      tabs={[
        { id: "dashboard", label: "Dashboard", content: <Dashboard openWo={openWo} /> },
        { id: "properties", label: "Properties", content: <Properties /> },
        { id: "tenants", label: "Tenants", content: <Tenants /> },
        { id: "work-orders", label: "Work orders", content: <WorkOrders selected={selectedWo} onSelect={setSelectedWo} /> },
        { id: "payments", label: "Payments", content: <Payments /> },
        { id: "ratings", label: "Ratings", content: <Ratings /> },
        { id: "assistant", label: "Assistant", content: <Assistant /> },
      ]}
    />
  );
}

function Dashboard({ openWo }: { openWo: (id: string) => void }) {
  const { state, act } = useDemo();
  const units = state.properties.reduce((a, p) => a + p.units, 0);
  const occupied = state.properties.reduce((a, p) => a + p.occupied, 0);
  const oct = state.invoices.filter((i) => i.due === "2026-10-01");
  const collected = oct.filter((i) => i.status === "Paid").reduce((a, i) => a + i.amount, 0);
  const billed = oct.reduce((a, i) => a + i.amount, 0);
  const overdue = state.invoices.filter((i) => i.status === "Overdue");
  const renewals = state.tenancies.filter((t) => t.status === "Renewal due");
  const submitted = state.workOrders.filter((w) => w.status === "Submitted");
  const low = lowRatings(state.ratings);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Properties" value={String(state.properties.length)} sub={`${units} units`} />
        <Stat label="Occupancy" value={`${Math.round((occupied / units) * 100)}%`} sub={`${occupied} of ${units} units`} />
        <Stat label="October rent collected" value={money(collected)} sub={`of ${money(billed)} billed`} />
        <Stat label="Needs attention" value={String(overdue.length + renewals.length + submitted.length + low.length)} sub="alerts below" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Alerts and quick actions" className="lg:col-span-3">
          <ul className="divide-y divide-[#1C1917]/[0.06]">
            {overdue.map((i) => {
              const t = state.tenancies.find((x) => x.id === i.tenancyId)!;
              const name = userName(state, t.tenantId);
              return (
                <AlertRow key={i.id} href={`/pm/tenancies/${t.id}`} tone="red" title={`Rent overdue: ${name}`} detail={`${propName(state, t.propertyId)} ${t.unit} · ${money(i.amount)} due ${i.due}`}>
                  <Button variant="secondary" onClick={() => act.nudge(t.tenantId, `Hi ${name.split(" ")[0]}, your rent of ${money(i.amount)} was due ${i.due}. Pay in the app, or reply PLAN to set up a payment plan.`, "Maya Patel")}>
                    Nudge tenant
                  </Button>
                </AlertRow>
              );
            })}
            {renewals.map((t) => {
              const name = userName(state, t.tenantId);
              return (
                <AlertRow key={t.id} href={`/pm/tenancies/${t.id}`} tone="amber" title={`Lease renewal: ${name}`} detail={`${propName(state, t.propertyId)} ${t.unit} · ends ${t.leaseEnd}`}>
                  <Button variant="secondary" onClick={() => act.nudge(t.tenantId, `Hi ${name.split(" ")[0]}, your lease ends ${t.leaseEnd}. We'd love you to stay — renew for 12 months at ${money(t.rent)}/month? Reply YES.`, "Maya Patel")}>
                    Send renewal offer
                  </Button>
                </AlertRow>
              );
            })}
            {submitted.map((w) => (
              <AlertRow key={w.id} href={`/pm/work-orders/${w.id}`} tone="blue" title={`Invoice to validate: ${w.id}`} detail={`${vendorName(state, w.vendorId)} · ${w.title} · ${money(w.submission?.total ?? 0)} vs PO ${money(w.po.total)}`}>
                <Button variant="secondary" onClick={() => openWo(w.id)}>Review</Button>
              </AlertRow>
            ))}
            {low.map((r) => (
              <AlertRow
                key={r.id}
                href={state.workOrders.some((w) => w.id === r.ref) ? `/pm/work-orders/${r.ref}` : undefined}
                tone="red"
                title={`Low rating: ${r.stars}★ for ${subjectName(state, r.subject)}`}
                detail={`${userName(state, r.by)}${r.ref ? ` · ${r.ref}` : ""} · “${r.comment}”`}
              >
                <span />
              </AlertRow>
            ))}
            {overdue.length + renewals.length + submitted.length + low.length === 0 && <li className="py-3 text-sm text-[#78716C]">All clear.</li>}
          </ul>
        </Card>
        <Card title="Agent activity" className="lg:col-span-2">
          <ul className="space-y-3">
            {state.audit.slice(0, 7).map((a) => (
              <li key={a.id} className="text-sm">
                <div className="text-xs text-[#78716C]">{a.ts} · {a.actor}</div>
                <div className="font-medium text-[#292524]">{a.action}</div>
                <div className="text-[#57534E]">{linkWorkOrders(a.detail)}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

// Turns "WO-1041" mentions in activity text into links to the work order page.
function linkWorkOrders(text: string) {
  return text.split(/(WO-\d+)/).map((part, i) =>
    /^WO-\d+$/.test(part) ? (
      <Link key={i} href={`/pm/work-orders/${part}`} className="font-medium text-[#6F5337] underline underline-offset-4">{part}</Link>
    ) : (
      part
    ),
  );
}

function AlertRow({ href, tone, title, detail, children }: { href?: string; tone: "red" | "amber" | "blue"; title: string; detail: string; children: React.ReactNode }) {
  const dot = { red: "bg-[#A4502F]", amber: "bg-[#B7862F]", blue: "bg-[#8A6A45]" }[tone];
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="text-sm font-medium text-[#1C1917] underline-offset-4 hover:underline">{title}</Link>
        ) : (
          <div className="text-sm font-medium text-[#1C1917]">{title}</div>
        )}
        <div className="text-xs text-[#78716C]">{detail}</div>
      </div>
      {children}
    </li>
  );
}

function Properties() {
  const { state } = useDemo();
  return (
    <Card title="Properties" action={<Link href="/onboarding" className="text-[13px] font-medium text-[#6F5337] underline underline-offset-4">Import tenancies</Link>}>
      <Table
        head={["Property", "Type", "Units", "Occupancy", "Owner", "Open work orders"]}
        rows={state.properties.map((p) => [
          <div key="n"><Link href={`/pm/properties/${p.id}`} className="font-medium text-[#1C1917] underline-offset-4 hover:underline">{p.name}</Link><div className="text-xs text-[#78716C]">{p.address}</div></div>,
          p.type,
          p.units,
          `${p.occupied}/${p.units}`,
          userName(state, p.ownerId),
          state.workOrders.filter((w) => w.propertyId === p.id && isOpenWorkOrder(w)).length,
        ])}
      />
    </Card>
  );
}

function Tenants() {
  const { state, act } = useDemo();
  return (
    <Card title="Tenancies">
      <Table
        head={["Tenant", "Property", "Rent", "Lease ends", "Status", "Latest invoice", ""]}
        rows={state.tenancies.map((t) => {
          const inv = state.invoices.filter((i) => i.tenancyId === t.id).sort((a, b) => (a.due < b.due ? -1 : 1));
          const open = inv.find((i) => i.status === "Overdue") ?? inv.at(-1)!;
          const name = userName(state, t.tenantId);
          return [
            <Link key="n" href={`/pm/tenancies/${t.id}`} className="font-medium text-[#1C1917] underline-offset-4 hover:underline">{name}</Link>,
            `${propName(state, t.propertyId)} ${t.unit}`,
            money(t.rent),
            t.leaseEnd,
            <Badge key="s" tone={statusTone(t.status)}>{t.status}</Badge>,
            <span key="i">{open.id} <Badge tone={statusTone(open.status)}>{open.status}</Badge></span>,
            <Button key="b" variant="secondary" onClick={() => act.nudge(t.tenantId, `Hi ${name.split(" ")[0]}, reminder: ${open.id} for ${money(open.amount)} is ${open.status.toLowerCase()} (due ${open.due}).`, "Maya Patel")}>
              Nudge
            </Button>,
          ];
        })}
      />
    </Card>
  );
}

function WorkOrders({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { state } = useDemo();
  const wo = state.workOrders.find((w) => w.id === selected) ?? state.workOrders[0];
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card title="Work orders" className="lg:col-span-2">
        <ul className="-mx-2 space-y-1">
          {state.workOrders.map((w) => (
            <li key={w.id}>
              <button onClick={() => onSelect(w.id)} className={`w-full rounded-2xl px-3 py-2.5 text-left transition-colors duration-300 ${w.id === wo.id ? "bg-[#8A6A45]/10" : "hover:bg-[#1C1917]/[0.03]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#1C1917]">{w.id}</span>
                  <Badge tone={statusTone(w.status)}>{w.status}</Badge>
                </div>
                <div className="text-sm text-[#44403C]">{w.title}</div>
                <div className="text-xs text-[#78716C]">{propName(state, w.propertyId)} {w.unit} · {vendorName(state, w.vendorId)}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="lg:col-span-3">
        <WorkOrderDetail wo={wo} />
      </div>
    </div>
  );
}

export function WorkOrderDetail({ wo, full = false }: { wo: WorkOrder; full?: boolean }) {
  const { state, act } = useDemo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function validate() {
    setBusy(true);
    setError(null);
    const key = submissionKey(wo);
    try {
      const res = await fetch("/api/ai/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workOrder: wo }) });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Validation failed. Try again.");
      else act.setValidation(wo.id, json as ValidationResult, key);
    } catch {
      setError("Couldn't reach the validation service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const v = wo.validation;
  const canDecide = wo.status === "Submitted" && v;
  const available = trustBalance(state).available;
  const fundsOk = wo.vendorId === "in-house" || (wo.submission?.total ?? 0) <= available;
  return (
    <Card
      title={wo.title}
      action={<span className="flex items-center gap-2"><span className="text-xs font-medium tabular-nums tracking-[0.08em] text-[#78716C]">{wo.id}</span><Badge tone={statusTone(wo.status)}>{wo.status}</Badge></span>}
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[#57534E]">
          <span>{propName(state, wo.propertyId)} {wo.unit} · {vendorName(state, wo.vendorId)} · est. {wo.estimatedHours} h</span>
          {!full && <Link href={`/pm/work-orders/${wo.id}`} className="text-[13px] font-medium text-[#6F5337] underline underline-offset-4">Open full page →</Link>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[1.25rem] bg-[#F6F2EA] p-4 ring-1 ring-[#1C1917]/[0.06]">
            <div className="text-xs font-semibold text-[#78716C]">Purchase order {wo.po.number}</div>
            <ul className="mt-2 space-y-1">
              {wo.po.items.map((i) => <li key={i.description} className="flex justify-between gap-2"><span>{i.description}</span><span className="whitespace-nowrap tabular-nums">{money(i.amount)}</span></li>)}
            </ul>
            <div className="mt-2 flex justify-between border-t border-[#1C1917]/[0.06] pt-2 font-semibold"><span>Total</span><span className="whitespace-nowrap tabular-nums">{money(wo.po.total)}</span></div>
            <div className="mt-1 text-xs text-[#78716C]">{wo.po.photosRequired} photo(s) required</div>
          </div>
          <div className="rounded-[1.25rem] bg-[#F6F2EA] p-4 ring-1 ring-[#1C1917]/[0.06]">
            <div className="text-xs font-semibold text-[#78716C]">Vendor invoice {wo.submission?.invoiceNumber ?? ""}</div>
            {wo.submission ? (
              <>
                <ul className="mt-2 space-y-1">
                  {wo.submission.items.map((i) => <li key={i.description} className="flex justify-between gap-2"><span>{i.description}</span><span className="whitespace-nowrap tabular-nums">{money(i.amount)}</span></li>)}
                </ul>
                <div className="mt-2 flex justify-between border-t border-[#1C1917]/[0.06] pt-2 font-semibold"><span>Total</span><span className="whitespace-nowrap tabular-nums">{money(wo.submission.total)}</span></div>
                <div className="mt-2 space-y-1">
                  {wo.submission.photos.map((p) => (
                    <div key={p} className="flex items-center gap-2 text-xs text-[#57534E]"><span className="grid h-8 w-10 place-items-center rounded bg-[#1C1917]/10 text-[10px] text-[#78716C]">photo</span>{p}</div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-[#78716C]">Not submitted yet.</p>
            )}
          </div>
        </div>
        {full && wo.vendorId !== "in-house" && ["In progress", "Submitted", "Changes requested"].includes(wo.status) && (
          <InvoiceUpload applyLabel="Attach to this work order" onApply={(inv) => act.attachDocument(wo.id, inv)} />
        )}
        {wo.status === "Submitted" && (
          <Button onClick={validate} disabled={busy}>{busy ? "Validating…" : v ? "Re-run AI validation" : "Run AI validation"}</Button>
        )}
        {error && <p className="text-sm text-[#8E4327]" role="alert">{error}</p>}
        {v && <ValidationCard v={v} />}
        {["Payment pending", "Paid", "Completed"].includes(wo.status) && <PaidPanel wo={wo} />}
        {canDecide && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => act.approveWorkOrder(wo.id)} disabled={!fundsOk}>
                {v.decision === "approve" && v.confidence >= 0.85 ? "Approve & pay (one tap)" : "Approve & pay anyway"} · {money(wo.submission!.total)}
              </Button>
              <Button variant="danger" onClick={() => act.requestChanges(wo.id)}>Send back to vendor</Button>
            </div>
            {!fundsOk && <p className="text-sm text-[#8E4327]" role="alert">The trust account has {money(available)} available, not enough for this payout. Collect rent or wait for transfers to clear.</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

function Assistant() {
  const { state } = useDemo();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: AskResult }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const examples = ["Who is late on rent?", "Which leases are up for renewal?", "What work orders are open?"];

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setQ("");
    try {
      const res = await fetch("/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, state }) });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "The assistant couldn't answer. Try again.");
      else {
        setError(null);
        setHistory((h) => [{ q: question, a: json as AskResult }, ...h]);
      }
    } catch {
      setError("Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Personal assistant">
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your portfolio…" className="min-w-0 flex-1 rounded-full border-0 bg-white/70 px-4 py-2 text-sm ring-1 ring-inset ring-[#1C1917]/12 focus:ring-2 focus:ring-[#1C1917]" />
        <Button type="submit" disabled={busy}>{busy ? "Thinking…" : "Ask"}</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((e) => <Button key={e} variant="secondary" onClick={() => ask(e)} disabled={busy}>{e}</Button>)}
      </div>
      {error && <p className="mt-3 text-sm text-[#8E4327]" role="alert">{error}</p>}
      <div className="mt-5 space-y-4">
        {history.map((h, i) => (
          <div key={i} className="space-y-2">
            <div className="text-sm font-medium text-[#1C1917]">{h.q}</div>
            <div className="whitespace-pre-line rounded-[1.25rem] bg-[#F6F2EA] p-4 text-sm text-[#292524]">{h.a.answer}</div>
            {h.a.suggestedActions.length > 0 && (
              <div className="text-sm text-[#57534E]">Suggested: {h.a.suggestedActions.join(" · ")}</div>
            )}
            <SourceNote source={h.a.source} note={h.a.note} />
          </div>
        ))}
      </div>
    </Card>
  );
}

const subjectName = (s: DemoState, subject: RatingSubject) =>
  subject.kind === "vendor" ? vendorName(s, subject.id) : subject.kind === "property" ? propName(s, subject.id) : userName(s, subject.id);

function PaidPanel({ wo }: { wo: WorkOrder }) {
  const { state } = useDemo();
  const payout = state.transfers.find((t) => t.kind === "Vendor payout" && t.ref === wo.id);
  const subject: RatingSubject | null =
    wo.vendorId !== "in-house" ? { kind: "vendor", id: wo.vendorId } : wo.assigneeId ? { kind: "maintenance", id: wo.assigneeId } : null;
  return (
    <div className="space-y-3">
      {payout && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#44403C]">
          Payout {money(payout.amount)} to {payout.to.name} <Badge tone={statusTone(payout.status)}>{payout.status}</Badge>
          {payout.status === "Pending" && <span className="text-xs text-[#78716C]">ACH in progress (simulated: clears in seconds)</span>}
        </div>
      )}
      {subject && isDoneWorkOrder(wo) && <RateBox by="u-pm" subject={subject} label={`Rate ${subjectName(state, subject)} for this job`} refId={wo.id} />}
    </div>
  );
}

function Payments() {
  const { state, act } = useDemo();
  const bal = trustBalance(state);
  const owners = state.users.filter((u) => u.role === "Owner");
  const party = (p: { name: string }) => p.name;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Trust account" value={money(bal.cleared)} sub="cleared balance" />
        <Stat label="Available" value={money(bal.available)} sub="after pending payouts" />
        <Stat label="Incoming" value={money(bal.pendingIn)} sub="rent clearing" />
        <Stat label="Outgoing" value={money(bal.pendingOut)} sub="payouts clearing" />
      </div>
      <Card title="Owner statements">
        <p className="mb-4 text-sm text-[#57534E]">
          Cleared rent, less the {Math.round(MANAGEMENT_FEE_RATE * 100)}% management fee and vendor bills on each owner&apos;s properties, since their last payout.
        </p>
        <Table
          head={["Owner", "Rent collected", "Management fee", "Vendor bills", "Owed", ""]}
          rows={owners.map((o) => {
            const st = ownerStatement(state, o.id);
            return [
              <span key="n" className="font-medium text-[#1C1917]">{o.name}</span>,
              money(st.rent),
              `− ${money(st.fees)}`,
              `− ${money(st.vendorBills)}`,
              <span key="o" className="font-medium tabular-nums">{money(st.net)}</span>,
              <Button key="b" onClick={() => act.disburseOwner(o.id)} disabled={st.net <= 0 || st.net > bal.available}>
                Pay owner
              </Button>,
            ];
          })}
        />
      </Card>
      <Card title="Transfers">
        <Table
          head={["Date", "Type", "From → To", "Amount", "Status", "Ref"]}
          rows={[...state.transfers].sort((a, b) => (a.created < b.created ? 1 : -1)).map((t) => [
            <span key="d" className="whitespace-nowrap tabular-nums">{t.created.slice(0, 10)}</span>,
            t.kind,
            `${party(t.from)} → ${party(t.to)}`,
            <span key="a" className="whitespace-nowrap tabular-nums">{money(t.amount)}</span>,
            <Badge key="s" tone={statusTone(t.status)}>{t.status}</Badge>,
            t.ref,
          ])}
        />
      </Card>
    </>
  );
}

function Ratings() {
  const { state } = useDemo();
  const subjects: RatingSubject[] = [
    { kind: "pm", id: "u-pm" },
    ...state.properties.map((p) => ({ kind: "property" as const, id: p.id })),
    ...state.users.filter((u) => u.role === "Maintenance").map((u) => ({ kind: "maintenance" as const, id: u.id })),
    ...state.vendors.map((v) => ({ kind: "vendor" as const, id: v.id })),
  ];
  const kindLabel = { pm: "Property manager", property: "Property", maintenance: "Maintenance", vendor: "Vendor" };
  return (
    <>
      <Card title="Ratings by subject">
        <Table
          head={["Who or what", "Type", "Rating", "Latest feedback"]}
          rows={subjects.map((sub) => {
            const r = ratingSummary(state.ratings, sub);
            return [
              <span key="n" className="font-medium text-[#1C1917]">{subjectName(state, sub)}</span>,
              kindLabel[sub.kind],
              <RatingBadge key="r" subject={sub} />,
              r.latest ? `“${r.latest.comment || "No comment"}” — ${userName(state, r.latest.by)}` : "—",
            ];
          })}
        />
      </Card>
      <Card title="All feedback">
        <Table
          head={["When", "From", "About", "Stars", "Comment"]}
          rows={state.ratings.map((r) => [
            <span key="w" className="whitespace-nowrap tabular-nums">{r.ts.slice(0, 10)}</span>,
            userName(state, r.by),
            `${subjectName(state, r.subject)}${r.ref ? ` · ${r.ref}` : ""}`,
            <Stars key="s" value={r.stars} />,
            r.comment || "—",
          ])}
        />
      </Card>
    </>
  );
}
