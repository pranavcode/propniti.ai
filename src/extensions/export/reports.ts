import "server-only";
import { cashForecast } from "@/extensions/accounting/metrics";
import { runSpec, scopeProperties, type Ctx } from "@/extensions/accounting/reports/run";
import { addMonths, canOpenReports, COMPARE_LABEL, describeSpec, FIRST_MONTH, GROUP_LABEL, measureOf, METROS, monthsBetween, periodLabel, type Compare, type GroupBy, type QuerySpec } from "@/extensions/accounting/reports/spec";
import { arAging, noiByProperty, pnl, rentRoll } from "@/extensions/accounting/reports/standard";
import { demoNowIso } from "@/lib/clock";
import { formatAsOf } from "@/lib/format";
import { capNote, EXPORT_CAP, type Column, type ExportDoc } from "@/lib/export/types";
import { asOfMonth, QueryError } from "@/server/query";

// Finance reports as export documents, re-run on the server with the same inputs as the page
// (/app/reports): the same roles, the person's property scope and the same period rules. The
// report builder's result is exported from its validated spec, so the model is not asked again.

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (label: string): Column => ({ label, kind: "money" });

// The builder's spec as URL params, for its Download menu.
export const askParams = (s: QuerySpec) => ({ r: "ask", measure: s.measure, group: s.groupBy, from: s.from, to: s.to, compare: s.compareTo, properties: s.properties.join(","), metros: s.metros.join(","), title: s.title });

export async function reportDoc(ctx: Ctx, sp: URLSearchParams, branded: boolean): Promise<ExportDoc & { name: string }> {
  if (!canOpenReports(ctx.actor.role)) throw new QueryError(403, "Reports aren't part of your role");
  const scope = await scopeProperties(ctx);
  const lastClosed = addMonths(await asOfMonth(ctx.db), -1);
  const r = sp.get("r") ?? "";
  const asked = sp.get("property");
  const property = asked ? scope.find((p) => p.id === asked) : undefined;
  if (asked && !property) throw new QueryError(403, "That property is outside your scope");
  let from = YM.test(sp.get("from") ?? "") ? sp.get("from")! : r === "pnl" ? `${lastClosed.slice(0, 4)}-01` : addMonths(lastClosed, -11);
  let to = YM.test(sp.get("to") ?? "") ? sp.get("to")! : lastClosed;
  if (from > to) [from, to] = [to, from];
  if (from < FIRST_MONTH) from = FIRST_MONTH;
  const where = `Property: ${property ? property.name : `All ${scope.length} properties`}`;
  const base = { branded, scope: ctx.actor.scope.label, generatedAt: demoNowIso() };

  if (r === "pnl") {
    const x = await pnl(ctx, from, to, property?.id);
    return { ...base, name: `pnl-${from}-${to}`, title: "Profit and loss", filters: [`Period: ${periodLabel(from, to)}`, where],
      columns: [{ label: "Section" }, { label: "GL" }, { label: "Account" }, money("Amount")],
      rows: [...x.rows.map((l) => [l.type, l.number, l.name, l.amount]), ["Total", "", "Income", x.income], ["Total", "", "Operating expense", x.expense], ["Total", "", "NOI", x.noi]] };
  }
  if (r === "rent_roll") {
    const size = 500;
    const first = await rentRoll(ctx, 1, size, property?.id);
    const rows = [...first.rows];
    for (let page = 2; rows.length < Math.min(first.total, EXPORT_CAP); page++) {
      const pg = (await rentRoll(ctx, page, size, property?.id)).rows;
      if (!pg.length) break;
      rows.push(...pg);
    }
    return { ...base, name: "rent-roll", title: "Rent roll", filters: [where], note: first.total > EXPORT_CAP ? capNote(first.total) : undefined,
      columns: [{ label: "Property" }, { label: "Unit" }, { label: "Unit status" }, { label: "Sq ft", kind: "number" }, money("Market rent"), { label: "Resident" }, { label: "Lease" }, { label: "Lease status" }, { label: "Start", kind: "date" }, { label: "End", kind: "date" }, money("Rent"), money("Deposit"), money("Balance")],
      rows: rows.slice(0, EXPORT_CAP).map((x) => [x.property, x.unit, x.status, x.sqft, x.market_rent, x.household, x.lease_id, x.lease_status, x.start_on, x.end_on, x.rent, x.deposit, x.balance]) };
  }
  if (r === "ar_aging") {
    const { rows, asOf } = await arAging(ctx, property?.id);
    const sum = (k: "d0_30" | "d31_60" | "d61_90" | "d90p" | "total" | "charges") => rows.reduce((a, x) => a + x[k], 0);
    return { ...base, name: `ar-aging-${asOf}`, title: "Accounts receivable aging", filters: [`As of ${formatAsOf(asOf)}`, where],
      columns: [{ label: "Property" }, money("0–30 days"), money("31–60"), money("61–90"), money("90+"), money("Total"), { label: "Charges", kind: "number" }],
      rows: [...rows.map((x) => [x.property, x.d0_30, x.d31_60, x.d61_90, x.d90p, x.total, x.charges]), ["Total", sum("d0_30"), sum("d31_60"), sum("d61_90"), sum("d90p"), sum("total"), sum("charges")]] };
  }
  if (r === "noi") {
    const x = await noiByProperty(ctx, from, to);
    return { ...base, name: `noi-${from}-${to}`, title: "NOI by property", filters: [`Period: ${periodLabel(from, to)}`],
      columns: [{ label: "Property" }, { label: "Metro" }, money("NOI"), money("Budget"), money("Variance"), { label: "Variance %", kind: "percent" }],
      rows: x.rows.map((y) => [y.property, y.metro, y.noi, y.budget, y.variance, y.pct]) };
  }
  if (r === "cash_forecast") {
    const f = await cashForecast({ db: ctx.db, ws: ctx.ws, actor: ctx.actor, propertyIds: ctx.actor.propertyIds, asOf: await asOfMonth(ctx.db) });
    return { ...base, name: "cash-forecast-90-days", title: "Cash forecast, next 90 days", filters: ["All trust accounts in scope, by week"],
      columns: [{ label: "Week starting", kind: "date" }, money("Rent in"), money("Open bills"), money("Recurring bills"), money("Other vendor spend"), money("Owner distributions"), money("Total out"), money("Balance")],
      rows: f.weeks.map((w) => [w.start, w.inflow, w.bills, w.recurring, w.other, w.distributions, w.outflow, w.balance]) };
  }
  if (r === "ask") {
    const m = measureOf(sp.get("measure") ?? "");
    const groupBy = sp.get("group") as GroupBy;
    const compareTo = (sp.get("compare") ?? "none") as Compare;
    if (!m || !m.groupBy.includes(groupBy) || !m.compare.includes(compareTo)) throw new QueryError(400, "That report spec isn't valid");
    if (from > lastClosed || to > lastClosed || monthsBetween(from, to) > 24) throw new QueryError(400, "That period isn't available");
    const properties = (sp.get("properties") ?? "").split(",").filter(Boolean);
    if (properties.some((id) => !scope.some((p) => p.id === id))) throw new QueryError(403, "That property is outside your scope");
    const metros = (sp.get("metros") ?? "").split(",").filter(Boolean);
    if (metros.some((x) => !(METROS as readonly string[]).includes(x))) throw new QueryError(400, "Unknown metro");
    const spec: QuerySpec = { measure: m.key, groupBy, from, to, compareTo, properties, metros, chart: "table", title: "" };
    spec.title = (sp.get("title") ?? "").trim().slice(0, 120) || describeSpec(spec, scope);
    const res = await runSpec(ctx, spec);
    const cmp = compareTo !== "none";
    return { ...base, name: spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60), title: spec.title, filters: [`Read as: ${describeSpec(spec, scope)}`], note: res.note,
      columns: [{ label: GROUP_LABEL[groupBy] }, money(m.label), ...(cmp ? [money(COMPARE_LABEL[compareTo]), money("Variance"), { label: "Variance %", kind: "percent" as const }] : [])],
      rows: res.rows.map((x) => [groupBy === "month" ? periodLabel(x.key, x.key) : x.label, x.value, ...(cmp ? [x.compare, x.value - (x.compare ?? 0), x.compare ? (x.value - x.compare) / Math.abs(x.compare) : null] : [])]) };
  }
  throw new QueryError(404, "Unknown report");
}
