"use client";

import { useState } from "react";
import { money } from "@/lib/mockAi";
import { useDemo } from "@/lib/store";
import { propName, userName, vendorName } from "@/lib/names";
import type { AskResult, ValidationResult, WorkOrder } from "@/lib/types";
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

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Properties" value={String(state.properties.length)} sub={`${units} units`} />
        <Stat label="Occupancy" value={`${Math.round((occupied / units) * 100)}%`} sub={`${occupied} of ${units} units`} />
        <Stat label="October rent collected" value={money(collected)} sub={`of ${money(billed)} billed`} />
        <Stat label="Needs attention" value={String(overdue.length + renewals.length + submitted.length)} sub="alerts below" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Alerts and quick actions" className="lg:col-span-3">
          <ul className="divide-y divide-[#1C1917]/[0.06]">
            {overdue.map((i) => {
              const t = state.tenancies.find((x) => x.id === i.tenancyId)!;
              const name = userName(state, t.tenantId);
              return (
                <AlertRow key={i.id} tone="red" title={`Rent overdue: ${name}`} detail={`${propName(state, t.propertyId)} ${t.unit} · ${money(i.amount)} due ${i.due}`}>
                  <Button variant="secondary" onClick={() => act.nudge(t.tenantId, `Hi ${name.split(" ")[0]}, your rent of ${money(i.amount)} was due ${i.due}. Pay in the app, or reply PLAN to set up a payment plan.`, "Maya Patel")}>
                    Nudge tenant
                  </Button>
                </AlertRow>
              );
            })}
            {renewals.map((t) => {
              const name = userName(state, t.tenantId);
              return (
                <AlertRow key={t.id} tone="amber" title={`Lease renewal: ${name}`} detail={`${propName(state, t.propertyId)} ${t.unit} · ends ${t.leaseEnd}`}>
                  <Button variant="secondary" onClick={() => act.nudge(t.tenantId, `Hi ${name.split(" ")[0]}, your lease ends ${t.leaseEnd}. We'd love you to stay — renew for 12 months at ${money(t.rent)}/month? Reply YES.`, "Maya Patel")}>
                    Send renewal offer
                  </Button>
                </AlertRow>
              );
            })}
            {submitted.map((w) => (
              <AlertRow key={w.id} tone="blue" title={`Invoice to validate: ${w.id}`} detail={`${vendorName(state, w.vendorId)} · ${w.title} · ${money(w.submission?.total ?? 0)} vs PO ${money(w.po.total)}`}>
                <Button variant="secondary" onClick={() => openWo(w.id)}>Review</Button>
              </AlertRow>
            ))}
            {overdue.length + renewals.length + submitted.length === 0 && <li className="py-3 text-sm text-[#78716C]">All clear.</li>}
          </ul>
        </Card>
        <Card title="Agent activity" className="lg:col-span-2">
          <ul className="space-y-3">
            {state.audit.slice(0, 7).map((a) => (
              <li key={a.id} className="text-sm">
                <div className="text-xs text-[#78716C]">{a.ts} · {a.actor}</div>
                <div className="font-medium text-[#292524]">{a.action}</div>
                <div className="text-[#57534E]">{a.detail}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function AlertRow({ tone, title, detail, children }: { tone: "red" | "amber" | "blue"; title: string; detail: string; children: React.ReactNode }) {
  const dot = { red: "bg-[#A4502F]", amber: "bg-[#B7862F]", blue: "bg-[#8A6A45]" }[tone];
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#1C1917]">{title}</div>
        <div className="text-xs text-[#78716C]">{detail}</div>
      </div>
      {children}
    </li>
  );
}

function Properties() {
  const { state } = useDemo();
  return (
    <Card title="Properties">
      <Table
        head={["Property", "Type", "Units", "Occupancy", "Owner", "Open work orders"]}
        rows={state.properties.map((p) => [
          <div key="n"><div className="font-medium text-[#1C1917]">{p.name}</div><div className="text-xs text-[#78716C]">{p.address}</div></div>,
          p.type,
          p.units,
          `${p.occupied}/${p.units}`,
          userName(state, p.ownerId),
          state.workOrders.filter((w) => w.propertyId === p.id && w.status !== "Paid").length,
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
            <span key="n" className="font-medium text-[#1C1917]">{name}</span>,
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

function WorkOrderDetail({ wo }: { wo: WorkOrder }) {
  const { state, act } = useDemo();
  const [busy, setBusy] = useState(false);

  async function validate() {
    setBusy(true);
    try {
      const res = await fetch("/api/ai/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workOrder: wo }) });
      act.setValidation(wo.id, (await res.json()) as ValidationResult);
    } finally {
      setBusy(false);
    }
  }

  const v = wo.validation;
  const canDecide = wo.status === "Submitted" && v;
  return (
    <Card
      title={wo.title}
      action={<span className="flex items-center gap-2"><span className="text-xs font-medium tabular-nums tracking-[0.08em] text-[#78716C]">{wo.id}</span><Badge tone={statusTone(wo.status)}>{wo.status}</Badge></span>}
    >
      <div className="space-y-4 text-sm">
        <div className="text-[#57534E]">{propName(state, wo.propertyId)} {wo.unit} · {vendorName(state, wo.vendorId)} · est. {wo.estimatedHours} h</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[1.25rem] bg-[#F6F2EA] p-4 ring-1 ring-[#1C1917]/[0.06]">
            <div className="text-xs font-semibold text-[#78716C]">Purchase order {wo.po.number}</div>
            <ul className="mt-2 space-y-1">
              {wo.po.items.map((i) => <li key={i.description} className="flex justify-between gap-2"><span>{i.description}</span><span className="tabular-nums">{money(i.amount)}</span></li>)}
            </ul>
            <div className="mt-2 flex justify-between border-t border-[#1C1917]/[0.06] pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{money(wo.po.total)}</span></div>
            <div className="mt-1 text-xs text-[#78716C]">{wo.po.photosRequired} photo(s) required</div>
          </div>
          <div className="rounded-[1.25rem] bg-[#F6F2EA] p-4 ring-1 ring-[#1C1917]/[0.06]">
            <div className="text-xs font-semibold text-[#78716C]">Vendor invoice {wo.submission?.invoiceNumber ?? ""}</div>
            {wo.submission ? (
              <>
                <ul className="mt-2 space-y-1">
                  {wo.submission.items.map((i) => <li key={i.description} className="flex justify-between gap-2"><span>{i.description}</span><span className="tabular-nums">{money(i.amount)}</span></li>)}
                </ul>
                <div className="mt-2 flex justify-between border-t border-[#1C1917]/[0.06] pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{money(wo.submission.total)}</span></div>
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
        {wo.status === "Submitted" && (
          <Button onClick={validate} disabled={busy}>{busy ? "Validating…" : v ? "Re-run AI validation" : "Run AI validation"}</Button>
        )}
        {v && <ValidationCard v={v} />}
        {canDecide && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => act.approveWorkOrder(wo.id)}>
              {v.decision === "approve" && v.confidence >= 0.85 ? "Approve & pay (one tap)" : "Approve & pay anyway"} · {money(wo.submission!.total)}
            </Button>
            <Button variant="danger" onClick={() => act.requestChanges(wo.id)}>Send back to vendor</Button>
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
  const examples = ["Who is late on rent?", "Which leases are up for renewal?", "What work orders are open?"];

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    setQ("");
    try {
      const res = await fetch("/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, state }) });
      const a = (await res.json()) as AskResult;
      setHistory((h) => [{ q: question, a }, ...h]);
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
