import { OPEN_STATUSES } from "@/extensions/maintenance/store";
import { sql } from "../data";
import { reassignTarget, vendorPool } from "../agents/maintenance";
import { THRESHOLDS, type Driver } from "./meta";
import { onProperty, openProposals, pct, pick, plural, type Improver, type StepDraft } from "./shared";

// Work orders past SLA: where they're stuck (not dispatched, with an overloaded vendor, on hold)
// and what the Maintenance triage agent can do: triage and dispatch new jobs, and move late jobs
// to a vendor with capacity. On-hold jobs need a person.

const CAP = 10;
type Wo = { id: string; property_id: string; property: string; metro: string; status: string; priority: string; category: string; vendor_id: string | null; sla_due_at: string | null };

export const slaImprover: Improver = {
  key: "sla",
  async analyze(c) {
    const p = onProperty(c, "w");
    // Past SLA as the maintenance pages count it: the due day is before today.
    const open = await sql<Wo>(c.data,
      `SELECT w.id, w.property_id, pr.name AS property, pr.metro, w.status, w.priority, w.category, w.vendor_id, w.sla_due_at
       FROM {work_orders} w JOIN {properties} pr ON pr.id = w.property_id WHERE w.status IN (SELECT value FROM json_each(?))${p.sql} ORDER BY w.sla_due_at`,
      [JSON.stringify(OPEN_STATUSES), ...p.params]);
    const late = open.filter((w) => w.sla_due_at && w.sla_due_at.slice(0, 10) < c.today);
    const vendors = await vendorPool(c.data);
    const name = new Map(vendors.map((v) => [v.id, v]));

    const undispatched = late.filter((w) => w.status === "New" || w.status === "Triaged");
    const withVendor = late.filter((w) => ["Assigned", "Scheduled", "In progress"].includes(w.status));
    const onHold = late.filter((w) => w.status === "On hold");
    const urgent = late.filter((w) => w.priority === "Emergency" || w.priority === "Urgent").length;
    const drivers: Driver[] = [];
    const list = `/app/maintenance/work-orders?view=past-sla${c.property ? `&f.property_id=${c.property}` : ""}`;
    if (late.length) {
      drivers.push({ text: `${plural(late.length, "open work order")} ${late.length === 1 ? "is" : "are"} past ${late.length === 1 ? "its" : "their"} SLA due day${urgent ? `, ${urgent} of them emergency or urgent` : ""}.`, share: open.length ? late.length / open.length : null, href: list });
      if (undispatched.length) drivers.push({ text: `${plural(undispatched.length, "late job")} ${undispatched.length === 1 ? "hasn't" : "haven't"} been dispatched yet (new or triaged).`, share: undispatched.length / late.length, href: "/app/maintenance/work-orders?f.status=New,Triaged" });
      const byVendor = new Map<string, number>();
      for (const w of withVendor) if (w.vendor_id) byVendor.set(w.vendor_id, (byVendor.get(w.vendor_id) ?? 0) + 1);
      const [topVendor, n] = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
      // A concentration of one job isn't a driver.
      if (topVendor && n && n > 1) {
        const v = name.get(topVendor);
        drivers.push({ text: `${n} of ${plural(late.length, "late job")} ${n === 1 ? "is" : "are"} with ${v?.company ?? "one vendor"}${v ? `, which has ${v.open_jobs} open jobs` : ""}.`, share: n / late.length, href: `/app/maintenance/work-orders?view=past-sla&f.vendor_id=${topVendor}` });
      }
      if (!c.property) {
        const byProp = new Map<string, { name: string; n: number }>();
        for (const w of late) byProp.set(w.property_id, { name: w.property, n: (byProp.get(w.property_id)?.n ?? 0) + 1 });
        const [pid, top] = [...byProp.entries()].sort((a, b) => b[1].n - a[1].n)[0];
        if (byProp.size > 1 && top.n > 1) drivers.push({ text: `${pct(top.n / late.length)} of late jobs are at ${top.name} (${top.n}).`, share: top.n / late.length, href: `/app/maintenance/work-orders?view=past-sla&f.property_id=${pid}` });
      }
      if (onHold.length) drivers.push({ text: `${plural(onHold.length, "late job")} ${onHold.length === 1 ? "is" : "are"} on hold.`, share: onHold.length / late.length, href: "/app/maintenance/work-orders?f.status=On%20hold" });
    }
    const reasons = [`SLA target is ${THRESHOLDS.slaBelow * 100}% of jobs done by their due time (emergency 4 h, urgent 24 h, normal 72 h).`];

    // Untriaged jobs: late first, then the soonest due. Jobs with a vendor: only past-SLA ones that
    // the agent's ranking would move to a vendor with fewer open jobs.
    const toTriage = open.filter((w) => w.status === "New" || w.status === "Triaged");
    const movable = withVendor.filter((w) => w.status !== "In progress" && reassignTarget(w, vendors, w.metro, c.today));
    const proposed = await openProposals(c, "maintenance_triage", [...toTriage, ...movable].map((w) => w.id));
    const triage = pick(toTriage, (w) => w.id, "work_orders.triage", proposed, CAP);
    const move = pick(movable, (w) => w.id, "work_orders.assign_vendor", proposed, CAP);
    const steps: StepDraft[] = [];
    if (triage.eligible) steps.push({
      key: "triage", title: `Triage and dispatch ${plural(triage.chosen.length, "new work order")}`,
      detail: "Trade, urgency and a cost estimate from past jobs, then the best insured vendor with capacity. Safety issues always go to a person; spend over the limit waits for approval.",
      agent: "maintenance_triage", action: "work_orders.triage", ids: triage.chosen.map((w) => w.id), records: triage.chosen.length, eligible: triage.eligible, waiting: triage.waiting,
      href: "/app/maintenance/work-orders?f.status=New,Triaged", risk: "Low", spend: true, mixedRisk: true, estimate: null,
    });
    if (move.eligible) steps.push({
      key: "reassign", title: `Move ${plural(move.chosen.length, "late job")} to vendors with capacity`,
      detail: "Only to an insured vendor for the same trade and metro with fewer open jobs than the current one. A person approves each switch.",
      agent: "maintenance_triage", action: "work_orders.assign_vendor", ids: move.chosen.map((w) => w.id), records: move.chosen.length, eligible: move.eligible, waiting: move.waiting,
      href: list, risk: "Medium", estimate: null,
    });
    if (onHold.length) steps.push({
      key: "on_hold", title: `Review ${plural(onHold.length, "late job")} on hold`,
      detail: "Holds wait on parts, access or an owner; a person decides whether to escalate or reschedule.",
      agent: null, action: null, ids: [], records: onHold.length, eligible: onHold.length, waiting: 0,
      href: "/app/maintenance/work-orders?f.status=On%20hold", risk: "Low", estimate: null,
    });
    return {
      headline: late.length ? `${plural(late.length, "work order")} past SLA out of ${open.length.toLocaleString("en-US")} open.` : `No open work orders are past SLA (${open.length.toLocaleString("en-US")} open).`,
      reasons, drivers, steps,
    };
  },

  async outcome(c, _since, ids) {
    const all = [...new Set(Object.values(ids).flat())];
    if (!all.length) return [];
    const [r] = await sql<{ done: number; late: number }>(c.data,
      `SELECT coalesce(sum(status IN ('Completed', 'Paid')), 0) AS done,
              coalesce(sum(status IN (SELECT value FROM json_each(?)) AND sla_due_at IS NOT NULL AND substr(sla_due_at, 1, 10) < ?), 0) AS late
       FROM {work_orders} WHERE id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(OPEN_STATUSES), c.today, JSON.stringify(all)]);
    return [`${Number(r?.done ?? 0)} of ${plural(all.length, "work order")} in the plan completed`, `${Number(r?.late ?? 0)} still past SLA`];
  },
};
