"use client";

import { useState } from "react";
import { money } from "@/lib/mockAi";
import { ownerStatement, vendorPaidYtd } from "@/lib/ledger";
import { sameSubject } from "@/lib/ratings";
import { DEMO_RESET_ZONE_NAME, PERSONAS } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { LineItem, WorkOrder } from "@/lib/types";
import { Shell, useAiMode } from "../Shell";
import { InvoiceUpload } from "../InvoiceUpload";
import { RateBox, RatingBadge, Stars } from "../Ratings";
import { Badge, Button, Card, Stat, Table, statusTone } from "../ui";
import { isDoneWorkOrder, isOpenWorkOrder, propName, userName, vendorName } from "@/lib/names";

export function OwnerView() {
  const { state } = useDemo();
  const me = PERSONAS.owner.userId;
  const props = state.properties.filter((p) => p.ownerId === me);
  const ids = props.map((p) => p.id);
  const tenancies = state.tenancies.filter((t) => ids.includes(t.propertyId));
  const units = props.reduce((a, p) => a + p.units, 0);
  const occupied = props.reduce((a, p) => a + p.occupied, 0);
  const payouts = state.transfers.filter((t) => t.kind === "Owner payout" && t.to.id === me);
  const st = ownerStatement(state, me);
  const wos = state.workOrders.filter((w) => ids.includes(w.propertyId));

  const overview = (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Your properties" value={String(props.length)} sub={`${units} units`} />
        <Stat label="Occupancy" value={`${Math.round((occupied / units) * 100)}%`} sub={`${occupied} of ${units}`} />
        <Stat label="Owed to you" value={money(st.net)} sub="next payout" />
        <Stat label="Open work orders" value={String(wos.filter(isOpenWorkOrder).length)} />
      </div>
      <Card title="Your properties">
        <Table
          head={["Property", "Type", "Occupancy", "Tenant rating", "Address"]}
          rows={props.map((p) => [<span key="n" className="font-medium text-[#1C1917]">{p.name}</span>, p.type, `${p.occupied}/${p.units}`, <RatingBadge key="r" subject={{ kind: "property", id: p.id }} />, p.address])}
        />
      </Card>
    </>
  );
  const tenants = (
    <Card title="Tenants in your properties">
      <Table
        head={["Tenant", "Unit", "Rent", "Lease ends", "Status"]}
        rows={tenancies.map((t) => [userName(state, t.tenantId), `${propName(state, t.propertyId)} ${t.unit}`, money(t.rent), t.leaseEnd, <Badge key="s" tone={statusTone(t.status)}>{t.status}</Badge>])}
      />
    </Card>
  );
  const maintenance = (
    <Card title="Work orders on your properties">
      <Table
        head={["ID", "Job", "Vendor", "PO total", "Status"]}
        rows={wos.map((w) => [w.id, `${w.title} (${w.unit})`, vendorName(state, w.vendorId), money(w.po.total), <Badge key="s" tone={statusTone(w.status)}>{w.status}</Badge>])}
      />
    </Card>
  );
  const statements = (
    <Card title="Payouts">
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["Rent collected", money(st.rent)],
          ["Management fee (8%)", `− ${money(st.fees)}`],
          ["Vendor bills", `− ${money(st.vendorBills)}`],
          ["Owed to you", money(st.net)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-2xl bg-[#F6F2EA] p-4 ring-1 ring-[#1C1917]/[0.06]">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#78716C]">{l}</div>
            <div className="mt-1 text-xl font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <p className="mb-4 text-sm text-[#57534E]">Open statement since your last payout. Your property manager sends it from the trust account by ACH.</p>
      <Table head={["Date", "Amount", "Reference", "Status"]} rows={payouts.map((p) => [<span key="d" className="whitespace-nowrap tabular-nums">{p.created.slice(0, 10)}</span>, money(p.amount), p.ref, <Badge key="s" tone={statusTone(p.status)}>{p.status}</Badge>])} />
    </Card>
  );
  return (
    <Shell
      persona="owner"
      tabs={[
        { id: "overview", label: "Overview", content: overview },
        { id: "tenants", label: "Tenants", content: tenants },
        { id: "maintenance", label: "Maintenance", content: maintenance },
        { id: "payouts", label: "Payouts", content: statements },
      ]}
    />
  );
}

export function TenantView() {
  const { state, act, busy } = useDemo();
  const me = PERSONAS.tenant.userId;
  const t = state.tenancies.find((x) => x.tenantId === me)!;
  const invoices = state.invoices.filter((i) => i.tenancyId === t.id).sort((a, b) => (a.due < b.due ? 1 : -1));
  const nextDue = invoices.find((i) => i.status !== "Paid");
  const myJobs = state.workOrders.filter((w) => w.propertyId === t.propertyId && w.unit === t.unit);
  const [issue, setIssue] = useState("");

  const home = (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Next payment" value={nextDue ? money(nextDue.amount) : "Paid up"} sub={nextDue ? `due ${nextDue.due}` : undefined} />
        <Stat label="Monthly rent" value={money(t.rent)} />
        <Stat label="Lease ends" value={t.leaseEnd} sub={t.status} />
        <Stat label="Open requests" value={String(myJobs.filter(isOpenWorkOrder).length)} />
      </div>
      <Card title="Your tenancy">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-[#78716C]">Home</dt><dd className="font-medium text-[#1C1917]">{propName(state, t.propertyId)} {t.unit}</dd></div>
          <div><dt className="text-[#78716C]">Lease</dt><dd className="font-medium text-[#1C1917]">{t.leaseStart} to {t.leaseEnd}</dd></div>
          <div><dt className="text-[#78716C]">Rent</dt><dd className="font-medium text-[#1C1917]">{money(t.rent)} {t.cadence.toLowerCase()}</dd></div>
          <div><dt className="text-[#78716C]">Status</dt><dd><Badge tone={statusTone(t.status)}>{t.status}</Badge></dd></div>
        </dl>
      </Card>
      <Card title="How are we doing?">
        <div className="grid gap-4 lg:grid-cols-2">
          <RateBox by={me} subject={{ kind: "pm", id: "u-pm" }} label={`Your property manager, ${userName(state, "u-pm")}`} />
          <RateBox by={me} subject={{ kind: "property", id: t.propertyId }} label={`Your building, ${propName(state, t.propertyId)}`} />
        </div>
      </Card>
    </>
  );
  const pay = (
    <Card title="Invoices and upcoming payments">
      <Table
        head={["Invoice", "Amount", "Due", "Status", ""]}
        rows={invoices.map((i) => [
          i.id,
          money(i.amount),
          i.due,
          <Badge key="s" tone={statusTone(i.status)}>{i.status}</Badge>,
          i.status === "Due" || i.status === "Overdue" ? <Button key="b" disabled={busy} onClick={() => act.payInvoice(i.id)}>Pay by bank (ACH)</Button> : i.status === "Processing" ? <span key="p" className="text-xs text-[#78716C]">Clearing…</span> : "",
        ])}
      />
      <p className="mt-3 text-xs text-[#78716C]">Simulated: ACH clears in seconds here instead of 1–2 business days, and no money moves. In production the bank is linked through Plaid and paid via Stripe.</p>
      <h3 className="mb-2 mt-6 font-serif text-xl">Your payments</h3>
      <Table
        head={["Date", "Invoice", "Amount", "Status"]}
        rows={state.transfers.filter((x) => x.kind === "Rent" && x.from.id === me).map((x) => [<span key="d" className="whitespace-nowrap tabular-nums">{x.created.slice(0, 10)}</span>, x.ref, money(x.amount), <Badge key="s" tone={statusTone(x.status)}>{x.status}</Badge>])}
        empty="No payments yet."
      />
    </Card>
  );
  const requests = (
    <Card title="Report an issue">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (issue.trim().length >= 5) {
            act.reportIssue(me, issue.trim());
            setIssue("");
          }
        }}
        className="flex gap-2"
      >
        <input value={issue} onChange={(e) => setIssue(e.target.value)} maxLength={200} aria-label="Describe the issue" placeholder="e.g. Kitchen sink is leaking" className="min-w-0 flex-1 rounded-full border-0 bg-white/70 px-4 py-2 text-sm ring-1 ring-inset ring-[#1C1917]/12" />
        <Button type="submit" disabled={busy || issue.trim().length < 5}>Submit</Button>
      </form>
      <div className="mt-4">
        <Table head={["ID", "Issue", "Status"]} rows={myJobs.map((w) => [w.id, w.title, <Badge key="s" tone={statusTone(w.status)}>{w.status}</Badge>])} empty="No requests yet." />
      </div>
      {myJobs
        .filter(isDoneWorkOrder)
        .map((w) => {
          const subject = w.vendorId === "in-house" ? { kind: "maintenance" as const, id: w.assigneeId ?? "u-m1" } : { kind: "vendor" as const, id: w.vendorId };
          const who = w.vendorId === "in-house" ? userName(state, subject.id) : vendorName(state, w.vendorId);
          return (
            <div key={w.id} className="mt-4">
              <RateBox by={me} subject={subject} refId={w.id} label={`Rate ${who} for ${w.id} · ${w.title}`} />
            </div>
          );
        })}
    </Card>
  );
  return (
    <Shell
      persona="tenant"
      tabs={[
        { id: "home", label: "Home", content: home },
        { id: "pay", label: "Rent and invoices", content: pay },
        { id: "requests", label: "Maintenance requests", content: requests },
      ]}
    />
  );
}

export function MaintenanceView() {
  const { state, act, busy } = useDemo();
  const me = PERSONAS.maintenance.userId;
  const jobs = state.workOrders.filter((w) => w.assigneeId === me);
  const [photo, setPhoto] = useState<Record<string, string>>({});

  const mine = state.ratings.filter((r) => sameSubject(r.subject, { kind: "maintenance", id: me }));
  const list = (
    <div className="space-y-4">
      <Card title="Your rating">
        <div className="flex flex-wrap items-center gap-4">
          <RatingBadge subject={{ kind: "maintenance", id: me }} />
          <span className="text-sm text-[#57534E]">From tenants and your property manager after each job.</span>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {mine.slice(0, 3).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2"><Stars value={r.stars} size="text-sm" /> “{r.comment || "No comment"}” <span className="text-xs text-[#78716C]">— {userName(state, r.by)}{r.ref ? `, ${r.ref}` : ""}</span></li>
          ))}
        </ul>
      </Card>
      {jobs.map((w) => (
        <Card key={w.id} title={w.title} action={<span className="flex items-center gap-2"><span className="text-xs font-medium tabular-nums tracking-[0.08em] text-[#78716C]">{w.id}</span><Badge tone={statusTone(w.status)}>{w.status}</Badge></span>}>
          <div className="space-y-3 text-sm">
            <div className="text-[#57534E]">{propName(state, w.propertyId)} {w.unit} · estimated {w.estimatedHours} h · {w.po.photosRequired} photo(s) required</div>
            {w.submission?.photos.length ? (
              <div className="space-y-1">{w.submission.photos.map((p) => <div key={p} className="text-xs text-[#57534E]">📷 {p}</div>)}</div>
            ) : null}
            {isOpenWorkOrder(w) && (
              <div className="flex flex-wrap items-center gap-2">
                {w.status === "Assigned" && <Button disabled={busy} onClick={() => act.updateJob(w.id, "In progress")}>Start job</Button>}
                <input
                  value={photo[w.id] ?? ""}
                  onChange={(e) => setPhoto({ ...photo, [w.id]: e.target.value })}
                  placeholder="Describe the photo (demo upload)"
                  className="min-w-0 flex-1 rounded-full border-0 bg-white/70 px-4 py-1.5 text-sm ring-1 ring-inset ring-[#1C1917]/12"
                />
                <Button variant="secondary" disabled={busy || !photo[w.id]} onClick={() => { act.updateJob(w.id, w.status, photo[w.id]); setPhoto({ ...photo, [w.id]: "" }); }}>
                  Add photo
                </Button>
                {w.status === "In progress" && <Button disabled={busy} onClick={() => act.updateJob(w.id, "Completed")}>Mark complete</Button>}
              </div>
            )}
          </div>
        </Card>
      ))}
      {jobs.length === 0 && <p className="text-sm text-[#78716C]">No jobs assigned.</p>}
    </div>
  );
  return <Shell persona="maintenance" tabs={[{ id: "jobs", label: "My jobs", content: list }]} />;
}

export function VendorView() {
  const { state } = useDemo();
  const vendor = state.vendors.find((v) => v.userId === PERSONAS.vendor.userId)!;
  const wos = state.workOrders.filter((w) => w.vendorId === vendor.id);
  const payouts = state.transfers.filter((t) => t.kind === "Vendor payout" && t.to.id === vendor.id);
  const feedback = state.ratings.filter((r) => sameSubject(r.subject, { kind: "vendor", id: vendor.id }));
  const paidYtd = vendorPaidYtd(state, vendor.id);

  const orders = (
    <div className="space-y-4">
      {wos.map((w) => <VendorWorkOrder key={w.id} wo={w} />)}
    </div>
  );
  const payments = (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Paid this year" value={money(paidYtd)} sub="cleared payouts" />
        <Stat label="1099-NEC" value={paidYtd >= 600 ? "Will be issued" : "Not required yet"} sub="IRS threshold $600 per year" />
        <Stat label="Payout method" value="ACH" sub="via Stripe Connect" />
      </div>
      <Card title="Payouts">
        <Table head={["Date", "Work order", "Amount", "Status"]} rows={payouts.map((p) => [<span key="d" className="whitespace-nowrap tabular-nums">{p.created.slice(0, 10)}</span>, p.ref, money(p.amount), <Badge key="s" tone={statusTone(p.status)}>{p.status}</Badge>])} />
      </Card>
    </>
  );
  const profile = (
    <Card title="Company profile">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[#78716C]">Company</dt><dd className="font-medium text-[#1C1917]">{vendor.company}</dd></div>
        <div><dt className="text-[#78716C]">Trade</dt><dd className="font-medium text-[#1C1917]">{vendor.trade}</dd></div>
        <div><dt className="text-[#78716C]">Contact</dt><dd className="font-medium text-[#1C1917]">{userName(state, vendor.userId)}</dd></div>
        <div><dt className="text-[#78716C]">W-9 on file</dt><dd><Badge tone="green">Yes</Badge></dd></div>
        <div><dt className="text-[#78716C]">Rating</dt><dd><RatingBadge subject={{ kind: "vendor", id: vendor.id }} /></dd></div>
      </dl>
      <h3 className="mb-2 mt-6 font-serif text-xl">Feedback</h3>
      <ul className="space-y-2 text-sm">
        {feedback.length === 0 && <li className="text-[#78716C]">No feedback yet.</li>}
        {feedback.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2"><Stars value={r.stars} size="text-sm" /> “{r.comment || "No comment"}” <span className="text-xs text-[#78716C]">— {userName(state, r.by)}{r.ref ? `, ${r.ref}` : ""}</span></li>
        ))}
      </ul>
    </Card>
  );
  return (
    <Shell
      persona="vendor"
      tabs={[
        { id: "orders", label: "Work orders", content: orders },
        { id: "payments", label: "Payments and 1099", content: payments },
        { id: "profile", label: "Profile", content: profile },
      ]}
    />
  );
}

function VendorWorkOrder({ wo }: { wo: WorkOrder }) {
  const { state, act, busy } = useDemo();
  const [items, setItems] = useState<LineItem[]>(wo.submission?.items ?? wo.po.items);
  const [photos, setPhotos] = useState<string>((wo.submission?.photos ?? []).join("\n"));
  const [invoiceNumber, setInvoiceNumber] = useState<string | undefined>(wo.submission?.invoiceNumber);
  const canSubmit = wo.status === "In progress" || wo.status === "Changes requested";
  const total = items.reduce((a, i) => a + i.amount, 0);
  const invoiceProblems = [
    ...(items.some((i) => !i.description.trim()) ? ["Every line needs a description"] : []),
    ...(items.some((i) => !Number.isFinite(i.amount) || i.amount < 0) ? ["Amounts must be zero or more"] : []),
    ...(total <= 0 ? ["The invoice total must be more than $0"] : []),
  ];

  return (
    <Card title={wo.title} action={<span className="flex items-center gap-2"><span className="text-xs font-medium tabular-nums tracking-[0.08em] text-[#78716C]">{wo.id}</span><Badge tone={statusTone(wo.status)}>{wo.status}</Badge></span>}>
      <div className="space-y-3 text-sm">
        <div className="text-[#57534E]">{propName(state, wo.propertyId)} {wo.unit} · PO {wo.po.number} for {money(wo.po.total)} · {wo.po.photosRequired} photo(s) required</div>
        {canSubmit ? (
          <div className="space-y-3 rounded-[1.25rem] bg-[#F6F2EA] p-4 ring-1 ring-[#1C1917]/[0.06]">
            <InvoiceUpload
              applyLabel="Fill my invoice from this"
              onApply={(inv) => {
                setItems(inv.lineItems);
                setInvoiceNumber(inv.invoiceNumber || undefined);
              }}
            />
            <div className="text-xs font-semibold text-[#78716C]">Your invoice{invoiceNumber ? ` ${invoiceNumber}` : ""}</div>
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <input value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className="min-w-0 flex-1 rounded-xl border-0 bg-white/70 px-3 py-1.5 ring-1 ring-inset ring-[#1C1917]/12" />
                <input type="number" value={Number.isFinite(it.amount) ? it.amount : ""} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, amount: e.target.value === "" ? NaN : Number(e.target.value) } : x)))} min={0} step="0.01" aria-label={`Amount for line ${i + 1}`} className="w-28 rounded-xl border-0 bg-white/70 px-3 py-1.5 text-right ring-1 ring-inset ring-[#1C1917]/12" />
              </div>
            ))}
            <Button variant="secondary" onClick={() => setItems([...items, { description: "Extra item", amount: 0 }])}>Add line</Button>
            <label className="block">
              <span className="text-xs text-[#78716C]">Photos (one description per line — demo upload)</span>
              <textarea value={photos} onChange={(e) => setPhotos(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border-0 bg-white/70 px-3 py-1.5 ring-1 ring-inset ring-[#1C1917]/12" placeholder="Before: …&#10;After: …" />
            </label>
            {invoiceProblems.length > 0 && <p className="text-sm text-[#8E4327]" role="alert">{invoiceProblems.join(" · ")}</p>}
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total {money(total)}</span>
              <Button
                disabled={busy || invoiceProblems.length > 0}
                onClick={() => act.submitInvoice(wo.id, items.map((i) => ({ ...i, description: i.description.trim() })), photos.split("\n").map((p) => p.trim()).filter(Boolean), invoiceNumber)}
              >
                Submit invoice
              </Button>
            </div>
          </div>
        ) : wo.submission ? (
          <div className="text-[#44403C]">Invoice {wo.submission.invoiceNumber} for {money(wo.submission.total)} submitted with {wo.submission.photos.length} photo(s).</div>
        ) : null}
      </div>
    </Card>
  );
}

export function AdminView() {
  const { state, act, busy } = useDemo();
  const mode = useAiMode();
  const users = (
    <Card title="Users">
      <Table
        head={["Name", "Role", "Contact", "Preferred channel", "ID verified"]}
        rows={state.users.map((u) => [<span key="n" className="font-medium text-[#1C1917]">{u.name}</span>, u.role, u.email, u.channel, <Badge key="v" tone={u.idVerified ? "green" : "amber"}>{u.idVerified ? "Verified" : "Pending"}</Badge>])}
      />
    </Card>
  );
  const health = (
    <>
      <Card title="System health (demo)">
        <Table
          head={["Component", "Status", "Note"]}
          rows={[
            ["AI provider", <Badge key="a" tone={mode?.source === "mock" ? "amber" : "green"}>{mode?.label ?? "…"}</Badge>, mode?.source === "mock" ? "Set ANTHROPIC_API_KEY or OPENAI_API_KEY to use a real model" : "Live model calls; falls back to mock on any error"],
            ["Scheduled sweep", <Badge key="s" tone="gray">Planned</Badge>, "Not running in this demo; agent activity shown is sample data. Production runs every 15 minutes"],
            ["Messaging (SMS, WhatsApp, voice, email)", <Badge key="m" tone="gray">Simulated</Badge>, "Messages land in each persona's Inbox"],
            ["Payments", <Badge key="p" tone="gray">Simulated</Badge>, "Trust-account ledger; ACH clears in seconds; no money moves"],
          ]}
        />
      </Card>
      <Card title="Demo data">
        <p className="mb-3 text-sm text-[#57534E]">Your demo data is private to you and resets at midnight {DEMO_RESET_ZONE_NAME}. Reset now to start the demo over.</p>
        <Button variant="danger" disabled={busy} onClick={act.reset}>Reset demo data</Button>
      </Card>
    </>
  );
  const audit = (
    <Card title="Audit log">
      <Table head={["Time", "Actor", "Action", "Detail"]} rows={state.audit.map((a) => [a.ts, a.actor, a.action, a.detail])} />
    </Card>
  );
  return (
    <Shell
      persona="admin"
      tabs={[
        { id: "health", label: "System", content: health },
        { id: "users", label: "Users", content: users },
        { id: "audit", label: "Audit log", content: audit },
      ]}
    />
  );
}
