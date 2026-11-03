import { FIRST, LAST } from "../../seed/catalog";
import { AS_OF } from "../../seed/constants";
import type { R, Tables } from "../../seed/generate";
import { day, iso, rng, round, ts, ym } from "../../seed/rng";
import { proposeRenewal } from "./pricing";

// Leasing base data (lane A calls this from src/seed/extras.ts): listings with price history and
// syndication, six months of prospects, showings, applicants, applications with screening
// summaries, concessions and renewal offers. Built only from rows already generated (units,
// leases, credits, role assignments), with its own random stream per record, so it is
// deterministic and never changes the ledger.

type Ctx = { t: Tables; add: (table: string, row: R) => R };

const COMMERCIAL = new Set(["Retail strip", "Office", "Industrial flex"]);
const TODAY = day(AS_OF);
const SOURCES = [["Zillow", 30], ["Apartments.com", 25], ["Website", 20], ["Walk-in", 8], ["Referral", 7], ["Facebook", 5], ["Google", 5]] as const;
const EMPLOYERS = ["Dell Technologies", "St. David's HealthCare", "Austin ISD", "H-E-B", "Delta Air Lines", "Emory Healthcare", "Banner Health", "Intel", "State Farm", "Home Depot", "City of Phoenix", "Texas Instruments", "AT&T", "Self-employed", "UT Austin", "Kaiser Permanente", "Charles Schwab", "Deloitte"];
// Planted fair-housing problems (the broker's compliance card and the listing editor flag these).
const RISKY = [
  "Perfect for young professionals who want to be close to downtown.",
  "Quiet adults-only floor, no children please.",
  "Ideal for a single person or couple.",
  "Mature residents preferred; no students.",
];

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? "");
const iso0 = (d: number) => iso(d);
const bedsLabel = (beds: number) => (beds === 0 ? "Studio" : `${beds}-bed`);

export function generateLeasing({ t, add }: Ctx) {
  const rows = (k: string) => t[k] ?? [];
  const props = rows("properties").filter((p) => !COMMERCIAL.has(s(p.type)));
  const propById = new Map(props.map((p) => [s(p.id), p]));
  const typeById = new Map(rows("unit_types").map((u) => [s(u.id), u]));
  const agentOf = new Map<string, string>();
  for (const ra of rows("role_assignments")) if (ra.role === "leasing_agent" && ra.scope_id) if (!agentOf.has(s(ra.scope_id))) agentOf.set(s(ra.scope_id), s(ra.staff_id));
  const agent = (pid: string) => agentOf.get(pid) ?? "s-yusuf";
  const leases = rows("leases");
  const futureLease = new Map(leases.filter((l) => l.status === "Future").map((l) => [s(l.unit_id), l]));
  const currentLease = new Map(leases.filter((l) => ["Active", "Notice", "Month-to-month"].includes(s(l.status))).map((l) => [s(l.unit_id), l]));

  // ---------------------------------------------------------------------------------------------
  // Listings: every vacant, make-ready or on-notice home, plus recently leased ones.
  // ---------------------------------------------------------------------------------------------
  const listingsByProp = new Map<string, R[]>();
  let risky = 0;
  for (const u of rows("units")) {
    const p = propById.get(s(u.property_id));
    if (!p || u.status === "Model" || u.status === "Down") continue;
    const fut = futureLease.get(s(u.id));
    if (!["Vacant", "Make-ready", "Notice"].includes(s(u.status)) && !fut) continue;
    const r = rng(`listing:${u.id}`);
    const ut = typeById.get(s(u.unit_type_id));
    const beds = n(ut?.beds), baths = n(ut?.baths) || 1;
    const market = n(u.market_rent_cents) || n(ut?.market_rent_cents);
    let status: string, listed: number, available: string | null;
    if (fut) {
      status = "Leased";
      listed = day(s(fut.start_on)) - r.int(18, 55);
      available = s(fut.start_on);
    } else if (u.status === "Notice") {
      status = r.chance(0.7) ? "Active" : "Draft";
      listed = TODAY - r.int(0, 24);
      available = s(currentLease.get(s(u.id))?.end_on) || s(u.available_on) || iso0(TODAY + 30);
    } else {
      status = u.status === "Make-ready" ? (r.chance(0.5) ? "Active" : "Draft") : r.weighted([["Active", 90], ["Paused", 5], ["Draft", 5]] as const);
      // Days on market skew short with a long tail (a few 90+ day vacancies).
      listed = TODAY - Math.min(140, Math.round(-Math.log(1 - r()) * (p.class === "C" ? 34 : p.class === "B" ? 26 : 20)));
      available = s(u.available_on) || iso0(TODAY);
    }
    const id = `lst-${s(u.id).replace(/^u-/, "")}`;
    let rent = market + round(r.normal(0, market * 0.015), 500);
    add("listing_price_history", { id: `lph-${id.slice(4)}-0`, listing_id: id, property_id: p.id, rent_cents: rent, changed_on: iso0(listed), reason: "Listed" });
    const dom = (fut ? day(s(fut.start_on)) - 7 : TODAY) - listed;
    for (const [k, after] of [[1, 30], [2, 60]] as const) {
      if (dom <= after || status === "Draft") break;
      const drop = round(rent * (0.02 + r() * 0.02), 500);
      rent -= drop;
      add("listing_price_history", { id: `lph-${id.slice(4)}-${k}`, listing_id: id, property_id: p.id, rent_cents: rent, changed_on: iso0(listed + after + r.int(0, 4)), reason: k === 1 ? "No applications in 30 days" : "Comparable units listed lower nearby" });
    }
    const amen: string[] = JSON.parse(s(p.amenities) || "[]");
    const sqft = n(u.sqft) || n(ut?.sqft);
    let description = r.chance(0.12) ? "" : `${bedsLabel(beds)}, ${baths}-bath home with ${sqft.toLocaleString("en-US")} sq ft on floor ${n(u.floor) || 1} at ${p.name} in ${p.neighborhood || p.city}. ${amen.length ? `Residents have ${amen.slice(0, 3).join(", ").toLowerCase()}.` : ""} Available ${available}.`;
    if (description && status !== "Leased" && risky < RISKY.length && r.chance(0.04)) description += ` ${RISKY[risky++]}`;
    const live = (pLive: number) => (r.chance(pLive) ? "Live" : r.chance(0.6) ? "Pending" : "Error");
    const syndication = status === "Active" ? { Zillow: live(0.9), "Apartments.com": live(0.85), Website: "Live", "Facebook Marketplace": r.chance(0.5) ? "Live" : "Off" }
      : status === "Leased" ? { Zillow: "Removed", "Apartments.com": "Removed", Website: "Removed", "Facebook Marketplace": "Off" }
        : status === "Paused" ? { Zillow: "Paused", "Apartments.com": "Paused", Website: "Paused", "Facebook Marketplace": "Off" }
          : { Zillow: "Off", "Apartments.com": "Off", Website: "Off", "Facebook Marketplace": "Off" };
    const unitPhotos: string[] = JSON.parse(s(ut?.photos) || "[]");
    const propPhotos: string[] = JSON.parse(s(p.photos) || "[]");
    const photos = status === "Draft" && r.chance(0.5) ? unitPhotos.slice(0, 2) : [...unitPhotos, ...propPhotos.slice(0, 2)];
    const views = Math.max(0, dom) * r.int(6, 22);
    const row = add("listings", {
      id, property_id: p.id, unit_id: u.id, headline: `${bedsLabel(beds)} ${baths}-bath · ${sqft.toLocaleString("en-US")} sq ft · #${u.number}`, description, rent_cents: rent,
      available_on: available, status, syndication: JSON.stringify(syndication), photos: JSON.stringify(photos), views, leads: Math.round(views * (0.03 + r() * 0.03)), listed_on: iso0(listed),
    });
    (listingsByProp.get(s(p.id)) ?? listingsByProp.set(s(p.id), []).get(s(p.id))!).push({ ...row, beds });
  }

  // ---------------------------------------------------------------------------------------------
  // Prospects, showings, applicants, applications and screening, over the last 6 months.
  // ---------------------------------------------------------------------------------------------
  let pn = 0, sn = 0, an = 1, apn = 0, scn = 0;
  const applicant = (prospectId: string | null, first: string, last: string, income: number, employer: string, created: string) => {
    const id = `apl-${String(an++).padStart(4, "0")}`;
    add("applicants", { id, prospect_id: prospectId, first_name: first, last_name: last, email: `${first}.${last}${an % 97}@mail.example`.toLowerCase().replace(/[^a-z0-9.@]/g, ""), phone: `(512) 555-${String(1000 + (an * 37) % 9000)}`, monthly_income_cents: income, employer, created_at: created });
    return id;
  };
  const screening = (r: ReturnType<typeof rng>, appId: string, aplId: string, pid: string, ratio: number, done: string, want?: "Fail") => {
    const band = want === "Fail" ? r.pick(["Poor", "Fair"] as const) : r.weighted([["Excellent", 22], ["Good", 38], ["Fair", 20], ["Thin file", 12], ["Poor", 8]] as const);
    const eviction = want === "Fail" ? (r.chance(0.5) ? 1 : 0) : r.chance(0.03) ? 1 : 0;
    const criminal = r.chance(0.03) ? 1 : 0;
    const verified = r.chance(0.82) ? 1 : 0;
    const decision = eviction || band === "Poor" || ratio < 2.2 ? "Fail" : criminal || band === "Fair" || band === "Thin file" || ratio < 3 || !verified ? "Conditional" : "Pass";
    const score = { Excellent: 780, Good: 710, Fair: 640, "Thin file": 0, Poor: 560 }[band] + r.int(-25, 25);
    add("screening_results", { id: `scr-${String(++scn).padStart(5, "0")}`, application_id: appId, applicant_id: aplId, property_id: pid, provider: "Sample Screening Co.", credit_band: band, score: band === "Thin file" ? null : score, eviction_found: eviction, criminal_flag: criminal, income_verified: verified, decision, completed_at: done });
  };

  // The applicant portal persona (Priyanka Rao, Barton Creek Commons) waits on the broker.
  const p02 = (listingsByProp.get("p02") ?? []).find((l) => l.status === "Active") ?? (listingsByProp.get("p02") ?? [])[0];
  if (p02) {
    const rent = n(p02.rent_cents);
    const prId = `pr-${String(++pn).padStart(5, "0")}`;
    add("prospects", { id: prId, property_id: "p02", name: "Priyanka Rao", email: "priyanka.rao@mail.example", phone: "(512) 555-0142", source: "Website", stage: "Applied", desired_beds: n(p02.beds), desired_move_in: iso0(TODAY + 24), budget_cents: rent + 10000, assigned_to: agent("p02"), last_contact_at: ts(TODAY - 1, 16 * 60), created_at: ts(TODAY - 12, 15 * 60 + 20) });
    add("showings", { id: `sh-${String(++sn).padStart(5, "0")}`, property_id: "p02", unit_id: p02.unit_id, prospect_id: prId, agent_id: agent("p02"), kind: "In person", scheduled_at: ts(TODAY - 9, 17 * 60), status: "Completed", feedback: "Loved the layout and the pool. Asked about parking for a second car." });
    const aplId = applicant(prId, "Priyanka", "Rao", Math.round(rent * 3.4), "Dell Technologies", ts(TODAY - 7, 18 * 60));
    const appId = `app-${String(++apn).padStart(5, "0")}`;
    add("applications", { id: appId, property_id: "p02", unit_id: p02.unit_id, listing_id: p02.id, applicant_id: aplId, co_applicants: "[]", stage: "Review", desired_move_in: iso0(TODAY + 24), rent_cents: rent, income_to_rent: 3.4, score: null, scoring_factors: "[]", recommendation: null, decided_by: null, decided_at: null, fee_paid: 1, submitted_at: ts(TODAY - 7, 18 * 60) });
    add("screening_results", { id: `scr-${String(++scn).padStart(5, "0")}`, application_id: appId, applicant_id: aplId, property_id: "p02", provider: "Sample Screening Co.", credit_band: "Good", score: 726, eviction_found: 0, criminal_flag: 0, income_verified: 0, decision: "Conditional", completed_at: ts(TODAY - 5, 15 * 60) });
  }

  for (const p of props) {
    const pid = s(p.id);
    const units = n(p.unit_count);
    const lst = listingsByProp.get(pid) ?? [];
    const open = lst.filter((l) => l.status === "Active" || l.status === "Draft");
    const pr = rng(`prospects:${pid}`);
    const count = Math.round(units * (0.55 + pr() * 0.2) * (p.status === "Lease-up" ? 1.6 : 1));
    for (let i = 0; i < count; i++) {
      const r = rng(`prospect:${pid}:${i}`);
      const age = Math.min(183, Math.floor(-Math.log(1 - r()) * 70)); // more recent leads than old ones
      const created = TODAY - age;
      const stage = age <= 3 ? r.weighted([["Inquiry", 60], ["Contacted", 40]] as const)
        : age <= 14 ? r.weighted([["Inquiry", 8], ["Contacted", 27], ["Tour scheduled", 22], ["Toured", 20], ["Applied", 15], ["Lost", 8]] as const)
          : age <= 30 ? r.weighted([["Contacted", 14], ["Tour scheduled", 5], ["Toured", 18], ["Applied", 20], ["Leased", 16], ["Lost", 27]] as const)
            : r.weighted([["Leased", 23], ["Lost", 68], ["Applied", 3], ["Toured", 6]] as const);
      const beds = r.weighted([[0, 10], [1, 45], [2, 35], [3, 10]] as const);
      const match = open.filter((l) => n(l.beds) === beds)[0] ?? open[r.int(0, Math.max(0, open.length - 1))] ?? lst[0];
      const budget = match ? round(n(match.rent_cents) * (0.92 + r() * 0.2), 2500) : null;
      const first = r.pick(FIRST), last = r.pick(LAST);
      const id = `pr-${String(++pn).padStart(5, "0")}`;
      // Active leads mostly heard from us recently; about one in six went quiet (follow-up due).
      const stale = ["Inquiry", "Contacted", "Toured"].includes(stage) && age > 3 && r.chance(0.35);
      const lastContact = stage === "Inquiry" && age <= 1 ? null : stale ? created + r.int(0, Math.max(0, age - 4)) : Math.min(TODAY, created + r.int(0, Math.min(age, 6)));
      add("prospects", {
        id, property_id: pid, name: `${first} ${last}`, email: `${first}.${last}${pn % 89}@mail.example`.toLowerCase(), phone: `(${p.metro === "Austin" ? 512 : p.metro === "Dallas" ? 214 : p.metro === "Atlanta" ? 404 : 602}) 555-${String(1000 + ((pn * 53) % 9000))}`,
        source: r.weighted(SOURCES), stage, desired_beds: beds, desired_move_in: iso0(created + r.int(14, 60)), budget_cents: budget, assigned_to: agent(pid),
        last_contact_at: lastContact == null ? null : ts(lastContact, r.int(14 * 60, 23 * 60)), created_at: ts(created, r.int(13 * 60, 26 * 60) % (24 * 60)),
      });
      const unitId = match ? s(match.unit_id) : null;
      const kind = r.weighted([["In person", 65], ["Self-guided", 25], ["Virtual", 10]] as const);
      const showing = (d: number, status: string, feedback = "") => add("showings", { id: `sh-${String(++sn).padStart(5, "0")}`, property_id: pid, unit_id: unitId, prospect_id: id, agent_id: kind === "Self-guided" ? null : agent(pid), kind, scheduled_at: ts(d, r.int(15, 23) * 60 + (r.chance(0.5) ? 30 : 0)), status, feedback });
      if (stage === "Tour scheduled") {
        const d = r.chance(0.3) ? TODAY : TODAY + r.int(1, 6);
        showing(d, "Scheduled");
      } else if (["Toured", "Applied", "Leased"].includes(stage) || (stage === "Lost" && r.chance(0.4))) {
        const d = Math.min(TODAY - 1, created + r.int(1, 6));
        const noShow = stage === "Lost" && r.chance(0.5);
        if (noShow) showing(d, "No-show");
        else showing(d, "Completed", r.pick(["Liked the unit; comparing two other communities.", "Asked about pet policy and parking.", "Concerned about street noise on that side.", "Wants a higher floor if one opens up.", "Ready to apply this week.", "Loved the kitchen; budget is tight.", ""]));
        if (stage === "Toured" && r.chance(0.12)) showing(TODAY + r.int(0, 3), "Scheduled"); // second visit
      }
      const applied = stage === "Applied" || stage === "Leased" || (stage === "Lost" && age > 20 && r.chance(0.12));
      if (!applied || !match) continue;
      const rent = n(match.rent_cents);
      const ratio = Math.round(r.weighted([[2.1, 8], [2.6, 17], [3.1, 30], [3.6, 25], [4.4, 20]] as const) * (0.95 + r() * 0.1) * 100) / 100;
      const sub = Math.min(TODAY, created + r.int(1, 8));
      const aplId = applicant(id, first, last, Math.round(rent * ratio), r.pick(EMPLOYERS), ts(sub, 18 * 60));
      const co = r.chance(0.18) ? [applicant(id, r.pick(FIRST), last, Math.round(rent * r.int(8, 20) / 10), r.pick(EMPLOYERS), ts(sub, 18 * 60))] : [];
      const appStage = stage === "Leased" ? "Leased"
        : stage === "Lost" ? r.weighted([["Denied", 55], ["Withdrawn", 45]] as const)
          : age <= 14 ? r.weighted([["Started", 10], ["Submitted", 25], ["Screening", 30], ["Review", 35]] as const)
            : r.weighted([["Approved", 40], ["Conditional", 15], ["Review", 20], ["Denied", 10], ["Withdrawn", 15]] as const);
      const appId = `app-${String(++apn).padStart(5, "0")}`;
      const decided = ["Approved", "Conditional", "Denied", "Leased"].includes(appStage);
      add("applications", {
        id: appId, property_id: pid, unit_id: unitId, listing_id: s(match.id), applicant_id: aplId, co_applicants: JSON.stringify(co), stage: appStage, desired_move_in: iso0(sub + r.int(10, 40)), rent_cents: rent,
        income_to_rent: ratio, score: null, scoring_factors: "[]", recommendation: null, decided_by: decided ? (r.chance(0.8) ? "rachel" : s(p.manager_id) || "rachel") : null,
        decided_at: decided ? ts(Math.min(TODAY, sub + r.int(2, 6)), 20 * 60) : null, fee_paid: appStage === "Started" ? 0 : 1, submitted_at: appStage === "Started" ? null : ts(sub, 18 * 60),
      });
      if (!["Started", "Submitted", "Screening"].includes(appStage) && appStage !== "Withdrawn") screening(r, appId, aplId, pid, ratio, ts(Math.min(TODAY, sub + r.int(1, 3)), 15 * 60), appStage === "Denied" ? "Fail" : undefined);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Concessions: the per-lease specials already credited in the ledger, plus property specials.
  // ---------------------------------------------------------------------------------------------
  const byLease = new Map<string, R[]>();
  for (const c of rows("credits")) if (c.kind === "Concession") (byLease.get(s(c.lease_id)) ?? byLease.set(s(c.lease_id), []).get(s(c.lease_id))!).push(c);
  const curPeriod = AS_OF.slice(0, 7);
  for (const [leaseId, cs] of byLease) {
    const months = [...new Set(cs.map((c) => s(c.on_date).slice(0, 7)))].sort();
    add("concessions", { id: `con-${leaseId}`, property_id: cs[0].property_id, lease_id: leaseId, label: s(cs[0].description), amount_cents: cs.reduce((a, c) => a + n(c.amount_cents), 0), months: JSON.stringify(months), approved_by: cs[0].approved_by, status: months.at(-1)! >= curPeriod ? "Active" : "Expired" });
  }
  const regional = (p: R) => (p.region_id === "r-tx" ? "priya" : p.region_id === "r-se" ? "s-wanjiru" : "s-colton");
  for (const p of props) {
    const r = rng(`special:${p.id}`);
    const vacant = (listingsByProp.get(s(p.id)) ?? []).filter((l) => l.status === "Active").length / Math.max(1, n(p.unit_count));
    if (p.status !== "Lease-up" && p.class !== "C" && vacant < 0.06 && !r.chance(0.25)) continue;
    const [label, amount] = r.pick([["6 weeks free on 13-month leases", 0], ["$750 off the first full month", 75_000], ["Waived application and admin fees", 27_500], ["One month free on 2- and 3-bedroom homes", 0]] as const);
    const status = p.status === "Lease-up" ? "Active" : r.weighted([["Active", 45], ["Proposed", 35], ["Expired", 20]] as const);
    const base = n((listingsByProp.get(s(p.id)) ?? [])[0]?.rent_cents) || 150_000;
    add("concessions", { id: `con-${p.id}-special`, property_id: p.id, lease_id: null, label, amount_cents: amount || base, months: JSON.stringify(status === "Expired" ? ["2026-06", "2026-07"] : [curPeriod, ym(TODAY + 31)]), approved_by: status === "Proposed" ? null : regional(p), status });
  }

  // ---------------------------------------------------------------------------------------------
  // Renewal offers: history for leases that renewed in the last six months, and offers in flight
  // for leases ending in the next 60 days. Later ones are left for the Renewals agent.
  // ---------------------------------------------------------------------------------------------
  const marketByUnit = new Map(rows("units").map((u) => [s(u.id), n(u.market_rent_cents) || null]));
  const leaseById = new Map(leases.map((l) => [s(l.id), l]));
  let ro = 0;
  const offer = (l: R, version: number, rent: number, status: string, sent: number, responded: number | null) =>
    add("renewal_offers", { id: `ro-${String(++ro).padStart(5, "0")}`, lease_id: l.id, property_id: l.property_id, version, term_months: 12, rent_cents: rent, current_rent_cents: l.rent_cents, market_rent_cents: marketByUnit.get(s(l.unit_id)) ?? null, status, sent_at: ts(sent, 15 * 60), responded_at: responded == null ? null : ts(responded, 19 * 60), expires_on: iso0(sent + 30) });
  for (const l of leases) {
    if (l.kind !== "Residential" || !propById.has(s(l.property_id))) continue;
    const prev = l.renewal_of ? leaseById.get(s(l.renewal_of)) : null;
    const start = day(s(l.start_on));
    if (prev && start >= TODAY - 183 && start <= TODAY + 60) {
      const sent = start - 75;
      offer(prev, 1, n(l.rent_cents), "Accepted", sent, sent + 9);
      continue;
    }
    if (l.status !== "Active" || !l.end_on) continue;
    const left = day(s(l.end_on)) - TODAY;
    if (left < 0 || left > 60) continue;
    const r = rng(`renewal:${l.id}`);
    const market = marketByUnit.get(s(l.unit_id)) ?? null;
    const rent = proposeRenewal({ currentCents: n(l.rent_cents), marketCents: market, tenureMonths: 12, late12: 0, nsf12: 0, balanceCents: 0 }).rentCents;
    const sent = day(s(l.end_on)) - r.int(62, 80);
    const pick = r.weighted([["Sent", 45], ["Countered", 15], ["Declined", 8], ["Expired", 5], ["None", 27]] as const);
    if (pick === "None" || sent > TODAY) continue;
    if (pick === "Countered") {
      offer(l, 1, rent, "Countered", sent, Math.min(TODAY, sent + r.int(3, 10)));
      offer(l, 2, Math.max(n(l.rent_cents), rent - 2500), "Sent", Math.min(TODAY, sent + r.int(11, 14)), null);
    } else offer(l, 1, rent, pick, sent, pick === "Sent" ? null : Math.min(TODAY, sent + r.int(5, 20)));
  }
}
