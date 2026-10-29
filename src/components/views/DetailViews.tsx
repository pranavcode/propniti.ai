"use client";

import Link from "next/link";
import { money } from "@/lib/mockAi";
import { isOpenWorkOrder, propName, userName, vendorName } from "@/lib/names";
import { useDemo } from "@/lib/store";
import { Shell } from "../Shell";
import { RatingBadge } from "../Ratings";
import { Badge, Button, Card, Stat, Table, statusTone } from "../ui";
import { WorkOrderDetail } from "./ManagerView";

const back = { href: "/pm", label: "Back to dashboard" };

function NotFound({ what }: { what: string }) {
  return (
    <Shell persona="pm" back={back} heading={<>Not <em className="text-[#8A6A45]">found.</em></>} tabs={[{ id: "x", label: "", content: <Card><p className="text-sm text-[#57534E]">This {what} doesn&apos;t exist in this demo. It may have been reset.</p></Card> }]} />
  );
}

const link = "font-medium text-[#1C1917] underline-offset-4 hover:underline";

export function WorkOrderPage({ id }: { id: string }) {
  const { state } = useDemo();
  const wo = state.workOrders.find((w) => w.id === id);
  if (!wo) return <NotFound what="work order" />;
  const related = state.audit.filter((a) => a.detail.includes(wo.id));
  return (
    <Shell
      persona="pm"
      back={back}
      heading={<>{wo.title}<span className="ml-3 align-middle font-sans text-base font-medium tracking-[0.08em] text-[#78716C]">{wo.id}</span></>}
      tabs={[
        {
          id: "wo",
          label: "",
          content: (
            <>
              <WorkOrderDetail wo={wo} full />
              <Card title="History">
                <Table head={["Time", "Who", "What"]} rows={related.map((a) => [a.ts, a.actor, `${a.action} · ${a.detail}`])} empty="No activity on this work order yet." />
              </Card>
            </>
          ),
        },
      ]}
    />
  );
}

export function TenancyPage({ id }: { id: string }) {
  const { state, act } = useDemo();
  const t = state.tenancies.find((x) => x.id === id);
  if (!t) return <NotFound what="tenancy" />;
  const tenant = state.users.find((u) => u.id === t.tenantId)!;
  const first = tenant.name.split(" ")[0];
  const invoices = state.invoices.filter((i) => i.tenancyId === t.id).sort((a, b) => (a.due < b.due ? 1 : -1));
  const open = invoices.find((i) => i.status === "Overdue") ?? invoices.find((i) => i.status !== "Paid");
  const messages = state.notifications.filter((n) => n.userId === tenant.id);
  const jobs = state.workOrders.filter((w) => w.propertyId === t.propertyId && w.unit === t.unit);
  return (
    <Shell
      persona="pm"
      back={back}
      heading={<>{tenant.name}</>}
      tabs={[
        {
          id: "t",
          label: "",
          content: (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Monthly rent" value={money(t.rent)} />
                <Stat label="Lease ends" value={t.leaseEnd} sub={t.status} />
                <Stat label="Outstanding" value={money(invoices.filter((i) => i.status === "Overdue").reduce((a, i) => a + i.amount, 0))} sub="overdue" />
                <Stat label="Open requests" value={String(jobs.filter(isOpenWorkOrder).length)} />
              </div>
              <div className="grid gap-6 lg:grid-cols-5">
                <Card title="Tenancy" className="lg:col-span-2">
                  <dl className="space-y-3 text-sm">
                    <div><dt className="text-[#78716C]">Home</dt><dd><Link href={`/pm/properties/${t.propertyId}`} className={link}>{propName(state, t.propertyId)}</Link> {t.unit}</dd></div>
                    <div><dt className="text-[#78716C]">Lease</dt><dd className="whitespace-nowrap tabular-nums">{t.leaseStart} to {t.leaseEnd}</dd></div>
                    <div><dt className="text-[#78716C]">Contact</dt><dd>{tenant.email} · {tenant.phone}</dd></div>
                    <div><dt className="text-[#78716C]">Prefers</dt><dd>{tenant.channel}</dd></div>
                    <div><dt className="text-[#78716C]">ID verified</dt><dd><Badge tone={tenant.idVerified ? "green" : "amber"}>{tenant.idVerified ? "Verified" : "Pending"}</Badge></dd></div>
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {open && (
                      <Button onClick={() => act.nudge(tenant.id, `Hi ${first}, reminder: ${open.id} for ${money(open.amount)} is ${open.status.toLowerCase()} (due ${open.due}).`, "Maya Patel")}>
                        Send rent reminder
                      </Button>
                    )}
                    {t.status === "Renewal due" && (
                      <Button variant="secondary" onClick={() => act.nudge(tenant.id, `Hi ${first}, your lease ends ${t.leaseEnd}. Renew for 12 months at ${money(t.rent)}/month? Reply YES.`, "Maya Patel")}>
                        Send renewal offer
                      </Button>
                    )}
                  </div>
                </Card>
                <Card title="Invoices" className="lg:col-span-3">
                  <Table head={["Invoice", "Amount", "Due", "Status"]} rows={invoices.map((i) => [i.id, money(i.amount), i.due, <Badge key="s" tone={statusTone(i.status)}>{i.status}</Badge>])} />
                </Card>
              </div>
              <Card title="Messages sent">
                <Table head={["When", "Channel", "Message"]} rows={messages.map((n) => [n.ts, n.channel, n.message])} empty="No messages yet." />
              </Card>
            </>
          ),
        },
      ]}
    />
  );
}

export function PropertyPage({ id }: { id: string }) {
  const { state } = useDemo();
  const p = state.properties.find((x) => x.id === id);
  if (!p) return <NotFound what="property" />;
  const tenancies = state.tenancies.filter((t) => t.propertyId === p.id);
  const wos = state.workOrders.filter((w) => w.propertyId === p.id);
  const rent = tenancies.reduce((a, t) => a + t.rent, 0);
  return (
    <Shell
      persona="pm"
      back={back}
      heading={<>{p.name}</>}
      tabs={[
        {
          id: "p",
          label: "",
          content: (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Type" value={p.type} />
                <Stat label="Occupancy" value={`${Math.round((p.occupied / p.units) * 100)}%`} sub={`${p.occupied} of ${p.units} units`} />
                <Stat label="Rent on file" value={money(rent)} sub={`${tenancies.length} tenancies tracked`} />
                <Stat label="Open work orders" value={String(wos.filter(isOpenWorkOrder).length)} />
              </div>
              <Card title="Details">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-[#78716C]">Address</dt><dd>{p.address}</dd></div>
                  <div><dt className="text-[#78716C]">Owner</dt><dd>{userName(state, p.ownerId)}</dd></div>
                  <div><dt className="text-[#78716C]">Tenant rating</dt><dd><RatingBadge subject={{ kind: "property", id: p.id }} /></dd></div>
                </dl>
              </Card>
              <Card title="Tenancies">
                <Table
                  head={["Tenant", "Unit", "Rent", "Lease ends", "Status"]}
                  rows={tenancies.map((t) => [
                    <Link key="n" href={`/pm/tenancies/${t.id}`} className={link}>{userName(state, t.tenantId)}</Link>,
                    t.unit,
                    money(t.rent),
                    t.leaseEnd,
                    <Badge key="s" tone={statusTone(t.status)}>{t.status}</Badge>,
                  ])}
                />
              </Card>
              <Card title="Work orders">
                <Table
                  head={["ID", "Job", "Vendor", "PO total", "Status"]}
                  rows={wos.map((w) => [
                    <Link key="i" href={`/pm/work-orders/${w.id}`} className={`${link} tabular-nums`}>{w.id}</Link>,
                    w.title,
                    vendorName(state, w.vendorId),
                    money(w.po.total),
                    <Badge key="s" tone={statusTone(w.status)}>{w.status}</Badge>,
                  ])}
                />
              </Card>
            </>
          ),
        },
      ]}
    />
  );
}
