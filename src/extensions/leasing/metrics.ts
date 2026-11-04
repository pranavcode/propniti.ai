import { effective } from "@/server/query";
import { AS_OF } from "@/seed/constants";
import { registerMetric, type MetricCtx, type MetricParams, type MetricResult } from "../metrics";

// Leasing KPIs and charts, computed live from the leasing tables (scoped to the persona's
// properties) rather than from metrics_monthly, so a moved card or a new lead shows up at once.

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.parse(AS_OF) - n * DAY).toISOString().slice(0, 10);

function scope(ctx: MetricCtx, p: MetricParams, col = "property_id") {
  const sql: string[] = [];
  const binds: unknown[] = [];
  if (ctx.propertyIds !== "all") {
    sql.push(`${col} IN (SELECT value FROM json_each(?))`);
    binds.push(JSON.stringify(ctx.propertyIds));
  }
  if (p.property) {
    sql.push(`${col} = ?`);
    binds.push(p.property);
  }
  return { sql: sql.map((s) => ` AND ${s}`).join(""), binds };
}

const T = (ctx: MetricCtx, table: string) => effective(table, ctx.ws);

async function one(ctx: MetricCtx, sql: string, binds: unknown[]) {
  const r = await ctx.db.prepare(sql).bind(...binds).first<Record<string, number | null>>();
  return r ?? {};
}

// A count or average over a trailing window, with the same window before it as "previous".
function windowed(key: `leasing.${string}`, label: string, q: (ctx: MetricCtx, p: MetricParams, from: string, to: string) => Promise<number | null>, days = 30, sparkWeeks = 12) {
  registerMetric({
    key, label,
    run: async (ctx, p): Promise<MetricResult> => {
      const [value, previous, ...spark] = await Promise.all([
        q(ctx, p, daysAgo(days), daysAgo(-1)),
        q(ctx, p, daysAgo(days * 2), daysAgo(days)),
        ...Array.from({ length: sparkWeeks }, (_, i) => q(ctx, p, daysAgo((sparkWeeks - i) * 7), daysAgo((sparkWeeks - i - 1) * 7))),
      ]);
      return { value, previous, spark: spark.map((v) => v ?? 0), points: [], source: "Leasing records, live" };
    },
  });
}

windowed("leasing.leads_30d", "Leads, last 30 days", async (ctx, p, from, to) => {
  const s = scope(ctx, p);
  return Number((await one(ctx, `SELECT count(*) AS n FROM ${T(ctx, "prospects")} WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) < ?${s.sql}`, [from, to, ...s.binds])).n ?? 0);
});

windowed("leasing.tour_conversion", "Lead-to-tour rate", async (ctx, p, from, to) => {
  const s = scope(ctx, p, "pr.property_id");
  const r = await one(ctx, `SELECT count(*) AS leads, sum(EXISTS (SELECT 1 FROM ${T(ctx, "showings")} sh WHERE sh.prospect_id = pr.id AND sh.status = 'Completed')) AS toured FROM ${T(ctx, "prospects")} pr WHERE substr(pr.created_at, 1, 10) >= ? AND substr(pr.created_at, 1, 10) < ?${s.sql}`, [from, to, ...s.binds]);
  return r.leads ? Number(r.toured ?? 0) / Number(r.leads) : null;
}, 30, 0);

windowed("leasing.approval_rate", "Approval rate", async (ctx, p, from, to) => {
  const s = scope(ctx, p);
  const r = await one(ctx, `SELECT sum(stage IN ('Approved', 'Conditional', 'Leased')) AS yes, count(*) AS n FROM ${T(ctx, "applications")} WHERE stage IN ('Approved', 'Conditional', 'Leased', 'Denied') AND substr(decided_at, 1, 10) >= ? AND substr(decided_at, 1, 10) < ?${s.sql}`, [from, to, ...s.binds]);
  return r.n ? Number(r.yes ?? 0) / Number(r.n) : null;
}, 90, 0);

// Point-in-time counts (no "previous").
function current(key: `leasing.${string}`, label: string, q: (ctx: MetricCtx, p: MetricParams) => Promise<number | null>) {
  registerMetric({ key, label, run: async (ctx, p) => ({ value: await q(ctx, p), previous: null, spark: [], points: [], source: "Leasing records, live" }) });
}

current("leasing.active_listings", "Active listings", async (ctx, p) => {
  const s = scope(ctx, p);
  return Number((await one(ctx, `SELECT count(*) AS n FROM ${T(ctx, "listings")} WHERE status = 'Active'${s.sql}`, s.binds)).n ?? 0);
});
current("leasing.avg_dom", "Average days on market", async (ctx, p) => {
  const s = scope(ctx, p);
  const r = await one(ctx, `SELECT avg(julianday(?) - julianday(listed_on)) AS d FROM ${T(ctx, "listings")} WHERE status = 'Active'${s.sql}`, [AS_OF, ...s.binds]);
  return r.d == null ? null : Math.round(Number(r.d));
});
current("leasing.follow_ups", "Follow-ups due", async (ctx, p) => {
  const s = scope(ctx, p);
  return Number((await one(ctx, `SELECT count(*) AS n FROM ${T(ctx, "prospects")} WHERE stage IN ('Inquiry', 'Contacted', 'Toured') AND julianday(?) - julianday(coalesce(last_contact_at, created_at)) BETWEEN 3 AND 30${s.sql}`, [AS_OF, ...s.binds])).n ?? 0);
});
current("leasing.tours_today", "Tours today", async (ctx, p) => {
  const s = scope(ctx, p);
  return Number((await one(ctx, `SELECT count(*) AS n FROM ${T(ctx, "showings")} WHERE substr(scheduled_at, 1, 10) = ?${s.sql}`, [AS_OF, ...s.binds])).n ?? 0);
});
current("leasing.pending_decisions", "Applications waiting on a decision", async (ctx, p) => {
  const s = scope(ctx, p);
  return Number((await one(ctx, `SELECT count(*) AS n FROM ${T(ctx, "applications")} WHERE stage = 'Review'${s.sql}`, s.binds)).n ?? 0);
});
current("leasing.concessions_proposed", "Concessions to approve", async (ctx, p) => {
  const s = scope(ctx, p);
  return Number((await one(ctx, `SELECT count(*) AS n FROM ${T(ctx, "concessions")} WHERE status = 'Proposed'${s.sql}`, s.binds)).n ?? 0);
});
// Rent lost this month on homes still listed: asking rent for each vacant day so far.
current("leasing.vacancy_loss_live", "Vacancy loss this month", async (ctx, p) => {
  const s = scope(ctx, p);
  const monthStart = `${AS_OF.slice(0, 7)}-01`;
  const r = await one(ctx, `SELECT sum(rent_cents * (julianday(?) - julianday(max(listed_on, ?))) / 30.4) AS c FROM ${T(ctx, "listings")} WHERE status IN ('Active', 'Paused', 'Draft')${s.sql}`, [AS_OF, monthStart, ...s.binds]);
  return r.c == null ? 0 : Math.round(Number(r.c)) / 100;
});

registerMetric({
  key: "leasing.pipeline_funnel",
  label: "Leasing funnel, last 90 days",
  run: async (ctx, p) => {
    // Joins instead of per-prospect EXISTS chains: one indexed pass per step (D1 CPU limit).
    const s = scope(ctx, p, "pr.property_id");
    const from = daysAgo(90);
    const P = `${T(ctx, "prospects")} pr`;
    const W = `substr(pr.created_at, 1, 10) >= ?${s.sql}`;
    const apps = (stages: string) => one(ctx, `SELECT count(DISTINCT ap.prospect_id) AS n FROM ${T(ctx, "applications")} a JOIN ${T(ctx, "applicants")} ap ON ap.id = a.applicant_id JOIN ${P} ON pr.id = ap.prospect_id WHERE a.stage ${stages} AND ${W}`, [from, ...s.binds]);
    const [l, t, ap, ok] = await Promise.all([
      one(ctx, `SELECT count(*) AS leads, sum(pr.stage = 'Leased') AS leased FROM ${P} WHERE ${W}`, [from, ...s.binds]),
      one(ctx, `SELECT count(DISTINCT sh.prospect_id) AS n FROM ${T(ctx, "showings")} sh JOIN ${P} ON pr.id = sh.prospect_id WHERE sh.status = 'Completed' AND ${W}`, [from, ...s.binds]),
      apps("<> 'Started'"),
      apps("IN ('Approved', 'Conditional', 'Leased')"),
    ]);
    const r = { leads: l.leads, tours: t.n, applied: ap.n, approved: ok.n, leased: l.leased };
    const points = [
      { stage: "Leads", key: "lead", count: Number(r.leads ?? 0) },
      { stage: "Toured", key: "tour", count: Number(r.tours ?? 0) },
      { stage: "Applied", key: "applied", count: Number(r.applied ?? 0) },
      { stage: "Approved", key: "approved", count: Number(r.approved ?? 0) },
      { stage: "Leased", key: "leased", count: Number(r.leased ?? 0) },
    ];
    return { value: points[4].count, points, source: "Prospects created in the last 90 days" };
  },
});

registerMetric({
  key: "leasing.dom_by_property",
  label: "Days on market by property",
  run: async (ctx, p) => {
    const s = scope(ctx, p, "l.property_id");
    const res = await ctx.db.prepare(`SELECT l.property_id, pp.name, count(*) AS listings, round(avg(julianday(?) - julianday(l.listed_on))) AS avg_dom FROM ${T(ctx, "listings")} l JOIN ${T(ctx, "properties")} pp ON pp.id = l.property_id WHERE l.status = 'Active'${s.sql} GROUP BY l.property_id ORDER BY avg_dom DESC`).bind(AS_OF, ...s.binds).all<Record<string, unknown>>();
    return { points: res.results.map((x) => ({ ...x, avg_dom: Number(x.avg_dom) })), source: "Active listings, live" };
  },
});

registerMetric({
  key: "leasing.leads_by_source",
  label: "Leads by source",
  run: async (ctx, p) => {
    const s = scope(ctx, p);
    const res = await ctx.db.prepare(`SELECT source, count(*) AS leads, sum(stage = 'Leased') AS leased FROM ${T(ctx, "prospects")} WHERE substr(created_at, 1, 10) >= ?${s.sql} GROUP BY source ORDER BY leads DESC`).bind(daysAgo(90), ...s.binds).all<Record<string, unknown>>();
    return { points: res.results.map((x) => ({ source: x.source, leads: Number(x.leads), leased: Number(x.leased ?? 0) })), source: "Prospects created in the last 90 days" };
  },
});

registerMetric({
  key: "leasing.weekly",
  label: "Leads, tours and applications per week",
  run: async (ctx, p) => {
    const weeks = 12;
    const from = daysAgo(weeks * 7);
    const wk = (col: string) => `CAST((julianday(substr(${col}, 1, 10)) - julianday(?)) / 7 AS INTEGER)`;
    const s = scope(ctx, p);
    const [leads, tours, apps] = await Promise.all([
      ctx.db.prepare(`SELECT ${wk("created_at")} AS w, count(*) AS n FROM ${T(ctx, "prospects")} WHERE substr(created_at, 1, 10) >= ?${s.sql} GROUP BY w`).bind(from, from, ...s.binds).all<{ w: number; n: number }>(),
      ctx.db.prepare(`SELECT ${wk("scheduled_at")} AS w, count(*) AS n FROM ${T(ctx, "showings")} WHERE status = 'Completed' AND substr(scheduled_at, 1, 10) >= ?${s.sql} GROUP BY w`).bind(from, from, ...s.binds).all<{ w: number; n: number }>(),
      ctx.db.prepare(`SELECT ${wk("submitted_at")} AS w, count(*) AS n FROM ${T(ctx, "applications")} WHERE submitted_at IS NOT NULL AND substr(submitted_at, 1, 10) >= ?${s.sql} GROUP BY w`).bind(from, from, ...s.binds).all<{ w: number; n: number }>(),
    ]);
    const at = (r: { results: { w: number; n: number }[] }, i: number) => Number(r.results.find((x) => Number(x.w) === i)?.n ?? 0);
    const points = Array.from({ length: weeks }, (_, i) => {
      const start = new Date(Date.parse(from) + i * 7 * DAY);
      return { week: start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), leads: at(leads, i), tours: at(tours, i), applications: at(apps, i) };
    });
    return { points, source: "Leasing records, weeks starting" };
  },
});

registerMetric({
  key: "leasing.applications_by_stage",
  label: "Applications by stage",
  run: async (ctx, p) => {
    const s = scope(ctx, p);
    const order = ["Submitted", "Screening", "Review", "Approved", "Conditional", "Denied", "Withdrawn", "Leased"];
    const res = await ctx.db.prepare(`SELECT stage, count(*) AS n FROM ${T(ctx, "applications")} WHERE coalesce(substr(submitted_at, 1, 10), ?) >= ?${s.sql} GROUP BY stage`).bind(AS_OF, daysAgo(90), ...s.binds).all<{ stage: string; n: number }>();
    return { points: order.map((stage) => ({ stage, count: Number(res.results.find((r) => r.stage === stage)?.n ?? 0) })).filter((x) => x.count), source: "Applications submitted in the last 90 days" };
  },
});

registerMetric({
  key: "leasing.renewals_by_status",
  label: "Renewal offers by status",
  run: async (ctx, p) => {
    const s = scope(ctx, p);
    const res = await ctx.db.prepare(`SELECT status, count(*) AS count FROM ${T(ctx, "renewal_offers")} WHERE coalesce(substr(sent_at, 1, 10), ?) >= ?${s.sql} GROUP BY status ORDER BY count DESC`).bind(AS_OF, daysAgo(183), ...s.binds).all<{ status: string; count: number }>();
    return { points: res.results.map((r) => ({ status: r.status, count: Number(r.count) })), source: "Offers sent in the last 6 months" };
  },
});

// Per agent: who works which leads and how they convert (broker home).
registerMetric({
  key: "leasing.agent_performance",
  label: "Leasing agent performance, last 30 days",
  run: async (ctx, p) => {
    const s = scope(ctx, p, "pr.property_id");
    const res = await ctx.db.prepare(`SELECT pr.assigned_to AS agent_id, st.name AS agent, count(*) AS leads,
        sum(EXISTS (SELECT 1 FROM ${T(ctx, "showings")} sh WHERE sh.prospect_id = pr.id AND sh.status = 'Completed')) AS tours,
        sum(pr.stage IN ('Applied', 'Leased')) AS applied, sum(pr.stage = 'Leased') AS leased,
        sum(pr.stage IN ('Inquiry', 'Contacted', 'Toured') AND julianday(?) - julianday(coalesce(pr.last_contact_at, pr.created_at)) >= 3) AS stale,
        round(avg(CASE WHEN pr.last_contact_at IS NOT NULL THEN (julianday(pr.last_contact_at) - julianday(pr.created_at)) * 24 END), 1) AS first_reply_h
      FROM ${T(ctx, "prospects")} pr LEFT JOIN ${T(ctx, "staff")} st ON st.id = pr.assigned_to WHERE substr(pr.created_at, 1, 10) >= ?${s.sql} GROUP BY pr.assigned_to ORDER BY leads DESC`).bind(AS_OF, daysAgo(30), ...s.binds).all<Record<string, unknown>>();
    return { points: res.results.map((r) => ({ ...r, leads: Number(r.leads), tours: Number(r.tours ?? 0), applied: Number(r.applied ?? 0), leased: Number(r.leased ?? 0), stale: Number(r.stale ?? 0), conversion: Number(r.leads) ? Number(r.leased ?? 0) / Number(r.leads) : 0 })), source: "Prospects created in the last 30 days" };
  },
});
