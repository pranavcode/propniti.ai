import { sql } from "../data";
import { FOLLOW_UP_STAGES, STALE_CONTACT_DAYS } from "../agents/leasing";
import { RENEWAL_WINDOW_DAYS } from "../agents/renewals";
import { THRESHOLDS, type Driver, type Estimate } from "./meta";
import { addDays, onProperty, openProposals, pct, pick, plural, rateEstimate, type ImproveCtx, type Improver, type StepDraft } from "./shared";

// Occupancy: where the empty units are and why (time on market, listings off the market, notices),
// and what the Leasing and Renewals agents can do: follow up quiet prospects, relist paused
// listings and send renewal offers before leases end. Rent changes stay with a person (What-if).

const CAP = 10;
const EMPTY = "('Vacant', 'Make-ready', 'Down')";

export const vacancyImprover: Improver = {
  key: "vacancy",
  async analyze(c) {
    const p = onProperty(c, "u");
    const stale30 = addDays(c.today, -30);
    const byProp = await sql<{ property_id: string; name: string; units: number; empty: number; notice: number; stale: number }>(c.data,
      `SELECT u.property_id, pr.name, count(*) AS units, sum(u.status IN ${EMPTY}) AS empty, sum(u.status = 'Notice') AS notice,
              sum(u.status IN ${EMPTY} AND u.available_on IS NOT NULL AND u.available_on < ?) AS stale
       FROM {units} u JOIN {properties} pr ON pr.id = u.property_id WHERE u.status <> 'Model'${p.sql} GROUP BY u.property_id, pr.name`,
      [stale30, ...p.params]);
    const units = byProp.reduce((s, r) => s + r.units, 0);
    const empty = byProp.reduce((s, r) => s + r.empty, 0);
    const notice = byProp.reduce((s, r) => s + r.notice, 0);
    const stale = byProp.reduce((s, r) => s + r.stale, 0);
    const withEmpty = byProp.filter((r) => r.empty > 0).map((r) => r.property_id);

    const offMarket = await sql<{ id: string; property_id: string; status: string; described: number }>(c.data,
      `SELECT l.id, l.property_id, l.status, length(trim(l.description)) > 0 AS described FROM {listings} l JOIN {units} u ON u.id = l.unit_id
       WHERE u.status IN ('Vacant', 'Make-ready') AND l.status IN ('Draft', 'Paused')${p.sql} ORDER BY l.listed_on`, p.params);
    const pr = onProperty(c, "x");
    const prospects = await sql<{ id: string; property_id: string }>(c.data,
      `SELECT x.id, x.property_id FROM {prospects} x WHERE x.stage IN (SELECT value FROM json_each(?)) AND x.last_contact_at < ?
         AND x.property_id IN (SELECT value FROM json_each(?))${pr.sql} ORDER BY x.last_contact_at`,
      [JSON.stringify(FOLLOW_UP_STAGES), addDays(c.today, -STALE_CONTACT_DAYS), JSON.stringify(withEmpty), ...pr.params]);
    const lp = onProperty(c, "l");
    const ending = await sql<{ id: string; end_on: string }>(c.data,
      `SELECT l.id, l.end_on FROM {leases} l WHERE l.status = 'Active' AND l.end_on BETWEEN ? AND ?${lp.sql}
         AND NOT EXISTS (SELECT 1 FROM {renewal_offers} o WHERE o.lease_id = l.id)
         AND EXISTS (SELECT 1 FROM {residents} r WHERE r.household_id = l.household_id AND r.is_primary = 1) ORDER BY l.end_on`,
      [c.today, addDays(c.today, RENEWAL_WINDOW_DAYS), ...lp.params]);

    const drivers: Driver[] = [];
    if (units) drivers.push({ text: `${plural(empty, "unit")} of ${units.toLocaleString("en-US")} are vacant, being made ready or down (${pct(empty / units)}); ${plural(notice, "more resident")} gave notice.`, share: empty / units, href: `/app/units?view=vacant${c.property ? `&f.property_id=${c.property}` : ""}` });
    if (empty && !c.property && byProp.length > 1) {
      const top = [...byProp].sort((a, b) => b.empty - a.empty).slice(0, 3).filter((r) => r.empty);
      const n = top.reduce((s, r) => s + r.empty, 0);
      drivers.push({ text: `${pct(n / empty)} of empty units are at ${top.map((r) => `${r.name} (${r.empty})`).join(", ")}.`, share: n / empty, href: `/app/units?view=vacant&f.property_id=${top[0].property_id}` });
    }
    if (stale) drivers.push({ text: `${plural(stale, "empty unit")} ${stale === 1 ? "has" : "have"} been available for over 30 days.`, share: empty ? stale / empty : null, href: `/app/units?view=vacant${c.property ? `&f.property_id=${c.property}` : ""}` });
    if (offMarket.length) drivers.push({ text: `${plural(offMarket.length, "vacant unit")} ${offMarket.length === 1 ? "has its listing" : "have listings"} paused or in draft, so no one sees ${offMarket.length === 1 ? "it" : "them"}.`, share: empty ? offMarket.length / empty : null, href: "/app/leasing/listings?f.status=Paused,Draft" });
    if (ending.length) drivers.push({ text: `${plural(ending.length, "lease")} ${ending.length === 1 ? "ends" : "end"} in the next ${RENEWAL_WINDOW_DAYS} days with no renewal offer sent.`, share: null, href: "/app/leases?view=expiring-90" });

    const reasons = units ? [`Physical occupancy is ${((units - empty) / units * 100).toFixed(1)}% today; the alert line is ${THRESHOLDS.occupancyBelow * 100}%.`] : [];

    const [openLeasing, openRenewals] = await Promise.all([
      openProposals(c, "leasing", [...prospects.map((x) => x.id), ...offMarket.map((x) => x.id)]),
      openProposals(c, "renewals", ending.map((x) => x.id)),
    ]);
    const follow = pick(prospects, (x) => x.id, "prospects.send_follow_up", openLeasing, CAP);
    const relist = pick(offMarket.filter((x) => Number(x.described)), (x) => x.id, "listings.publish", openLeasing, CAP);
    const renew = pick(ending, (x) => x.id, "leases.send_renewal_offer", openRenewals, CAP);
    const steps: StepDraft[] = [];
    if (follow.eligible) steps.push({
      key: "follow_up", title: `Follow up with ${plural(follow.chosen.length, "prospect")} nobody has contacted in ${STALE_CONTACT_DAYS}+ days`,
      detail: "Prospects at properties with empty units, quietest first. The note invites them to book a tour.",
      agent: "leasing", action: "prospects.send_follow_up", ids: follow.chosen.map((x) => x.id), records: follow.chosen.length, eligible: follow.eligible, waiting: follow.waiting,
      href: "/app/leasing/prospects", risk: "Low", estimate: await conversionEstimate(c, follow.chosen.length),
    });
    if (relist.eligible) steps.push({
      key: "relist", title: `Relist ${plural(relist.chosen.length, "paused or draft listing")} on vacant units`,
      detail: "Puts each listing back on the website and listing sites after a fair-housing wording check. Asking rent doesn't change.",
      agent: "leasing", action: "listings.publish", ids: relist.chosen.map((x) => x.id), records: relist.chosen.length, eligible: relist.eligible, waiting: relist.waiting,
      href: "/app/leasing/listings?f.status=Paused,Draft", risk: "Low", estimate: null,
    });
    if (renew.eligible) steps.push({
      key: "renew", title: `Send renewal offers on ${plural(renew.chosen.length, "lease")} ending soon`,
      detail: `Leases ending in the next ${RENEWAL_WINDOW_DAYS} days with no offer. Priced toward market rent, capped at +5%; residents behind on rent go to a person.`,
      agent: "renewals", action: "leases.send_renewal_offer", ids: renew.chosen.map((x) => x.id), records: renew.chosen.length, eligible: renew.eligible, waiting: renew.waiting,
      href: "/app/leases?view=expiring-90", risk: "Low", mixedRisk: true, estimate: await renewalEstimate(c, renew.chosen.length),
    });
    if (stale) steps.push({
      key: "price", title: `Review asking rent on ${plural(stale, "unit")} empty over 30 days`,
      detail: "Rent changes stay with a person: try a lower asking rent in What-if and see the effect on NOI before changing a listing.",
      agent: null, action: null, ids: [], records: stale, eligible: stale, waiting: 0,
      href: `/app/portfolio/what-if${c.property ? `?property=${c.property}` : ""}`, risk: "Medium", estimate: null,
    });
    return {
      headline: units ? `${plural(empty, "empty unit")} and ${plural(notice, "notice")} across ${plural(byProp.length, "property", "properties")}.` : "No units in this scope.",
      reasons, drivers, steps,
    };
  },

  async outcome(c, since, ids) {
    const out: string[] = [];
    const follow = ids["prospects.send_follow_up"] ?? [];
    const relist = ids["listings.publish"] ?? [];
    const renew = ids["leases.send_renewal_offer"] ?? [];
    if (follow.length) {
      const [r] = await sql<{ n: number }>(c.data, "SELECT count(*) AS n FROM {prospects} WHERE stage IN ('Applied', 'Leased') AND id IN (SELECT value FROM json_each(?))", [JSON.stringify(follow)]);
      out.push(`${Number(r?.n ?? 0)} of ${plural(follow.length, "prospect")} applied or leased`);
    }
    if (relist.length) {
      const [r] = await sql<{ n: number }>(c.data, "SELECT count(*) AS n FROM {listings} WHERE status IN ('Active', 'Leased') AND id IN (SELECT value FROM json_each(?))", [JSON.stringify(relist)]);
      out.push(`${Number(r?.n ?? 0)} of ${plural(relist.length, "listing")} live again`);
    }
    if (renew.length) {
      const [r] = await sql<{ n: number }>(c.data, "SELECT count(DISTINCT lease_id) AS n FROM {renewal_offers} WHERE status = 'Accepted' AND coalesce(responded_at, sent_at) >= ? AND lease_id IN (SELECT value FROM json_each(?))", [since.slice(0, 10), JSON.stringify(renew)]);
      out.push(`${Number(r?.n ?? 0)} of ${plural(renew.length, "lease")} renewed`);
    }
    return out;
  },
};

// Base rate, not a measured effect of follow-ups: of the prospects the team reached, how many went on.
async function conversionEstimate(c: ImproveCtx, n: number): Promise<Estimate | null> {
  const [r] = await sql<{ n: number; hits: number }>(c.data, "SELECT count(*) AS n, coalesce(sum(stage IN ('Applied', 'Leased')), 0) AS hits FROM {prospects} WHERE stage <> 'Inquiry'");
  const e = rateEstimate(Number(r?.hits ?? 0), Number(r?.n ?? 0));
  if (!e || !n) return null;
  const value = Math.round(e.rate * n);
  return {
    kind: "count", value, text: `About ${value} of ${plural(n, "prospect")} may apply or lease`, confidence: "Low", sample: Number(r.n),
    basis: `${pct(e.rate)} of ${Number(r.n).toLocaleString("en-US")} prospects your team has contacted went on to apply or lease. A base rate, not a measured effect of follow-ups.`,
  };
}

// Offers sent at least 30 days ago have had time for an answer.
async function renewalEstimate(c: ImproveCtx, n: number): Promise<Estimate | null> {
  const [r] = await sql<{ n: number; hits: number }>(c.data, "SELECT count(*) AS n, coalesce(sum(status = 'Accepted'), 0) AS hits FROM {renewal_offers} WHERE sent_at IS NOT NULL AND substr(sent_at, 1, 10) <= ?", [addDays(c.today, -30)]);
  const e = rateEstimate(Number(r?.hits ?? 0), Number(r?.n ?? 0));
  if (!e || !n) return null;
  const value = Math.round(e.rate * n);
  return {
    kind: "count", value, text: `About ${value} of ${plural(n, "lease")} renew`, confidence: e.confidence, sample: Number(r.n),
    basis: `${pct(e.rate)} of ${Number(r.n).toLocaleString("en-US")} renewal offers sent in your properties at least 30 days ago were accepted.`,
  };
}
