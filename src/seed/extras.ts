import { FIRST, LAST, RENTERS_CARRIERS, VENDORS } from "./catalog";
import { AS_OF } from "./constants";
import { ASOF, PERIODS, WO_TYPES, createWorkOrder, type Ctx, type Household, type Prop, type R, type Unit } from "./generate";
import { HELP_ARTICLES } from "./help";
import { addMonths, day, iso, monthStart, rng, round, ts, type Rng } from "./rng";

// Everything around the ledger that makes the product feel lived-in: policies and state rules,
// the leasing funnel, operations depth, communications, risk and compliance, AI agent history,
// collaboration (tasks, notes, activity), data-health rules with planted corrupted cases, and the
// curated records each demo persona lands on. Nothing here moves money: all money rows are
// generated (and reconciled) in generate.ts.

const regional = (p: Prop) => (p.region === "r-tx" ? "priya" : p.region === "r-se" ? "s-wanjiru" : "s-colton");
const CURRENT = new Set(["Active", "Notice", "Month-to-month", "Eviction"]);
const pick = <T>(r: Rng, xs: readonly T[]) => xs[r.int(0, xs.length - 1)];
const name = (h: Household) => (h.residents[0] ? `${h.residents[0].first_name} ${h.residents[0].last_name}` : h.name);
const mention = (c: Ctx, id: string) => `@[${c.staffName[id]}](staff:${id})`;

export function generateExtras(c: Ctx) {
  const x = new Extras(c);
  x.policies();
  x.leasing();
  x.operations();
  x.personaScenarios();
  x.documents();
  x.communications();
  x.risk();
  x.finance();
  x.collaboration();
  x.dataHealth();
  x.ai();
  x.settings();
  x.metricsFill();
}

class Extras {
  add: Ctx["add"];
  t: Ctx["t"];
  docN = 0;
  constructor(private c: Ctx) {
    this.add = c.add;
    this.t = c.t;
  }
  private n(k: string) {
    return this.c.next(`x:${k}`);
  }
  private currentLeases(p?: Prop) {
    return this.c.leases.filter((l) => CURRENT.has(l.status) && (!p || l.u.p === p));
  }
  activity(entityType: string, entityId: string, propertyId: string | null, at: string, actorKind: string, actorId: string, verb: string, summary: string, data: object = {}) {
    this.add("activity_events", { id: `act-${this.n("act")}`, entity_type: entityType, entity_id: entityId, property_id: propertyId, at, actor_kind: actorKind, actor_id: actorId, verb, summary, data: JSON.stringify(data) });
  }
  task(t: { title: string; detail?: string; entity?: [string, string]; property?: string | null; assignee?: string | null; role?: string | null; by?: string; due: number | null; priority?: string; status?: string; queue?: string; source?: string; created: number }) {
    const id = `task-${this.n("task")}`;
    const status = t.status ?? "Open";
    this.add("tasks", {
      id, title: t.title, detail: t.detail ?? "", entity_type: t.entity?.[0] ?? null, entity_id: t.entity?.[1] ?? null, property_id: t.property ?? null, assignee_id: t.assignee ?? null, assignee_role: t.role ?? null,
      created_by: t.by ?? "system", due_on: t.due === null ? null : iso(t.due), priority: t.priority ?? "Normal", status, queue_state: t.queue ?? (status === "Done" ? "auto_handled" : "needs_you"), source: t.source ?? "Manual",
      completed_at: status === "Done" ? ts(Math.min(ASOF, (t.due ?? t.created) - 1), 900) : null, created_at: ts(t.created, 600),
    });
    return id;
  }
  note(entityType: string, entityId: string, author: string, body: string, d: number, mentions: string[] = [], parent: string | null = null, pinned = false) {
    const id = `note-${this.n("note")}`;
    this.add("notes", { id, entity_type: entityType, entity_id: entityId, parent_id: parent, author_id: author, body, mentions: JSON.stringify(mentions), pinned: pinned ? 1 : 0, created_at: ts(d, 540 + this.n("nm") % 480) });
    return id;
  }

  // -------------------------------------------------------------------------------------------
  policies() {
    const { add } = this;
    add("late_fee_policies", { id: "lfp-org", property_id: null, grace_days: 3, kind: "Flat", flat_cents: 5000, pct: 0, daily_cents: 0, max_cents: null });
    for (const p of this.c.props) {
      if (p.state === "TX") add("late_fee_policies", { id: `lfp-${p.id}`, property_id: p.id, grace_days: 2, kind: "Percent", flat_cents: 0, pct: 10, daily_cents: 0, max_cents: null });
      else if (p.state === "GA") add("late_fee_policies", { id: `lfp-${p.id}`, property_id: p.id, grace_days: 5, kind: "Flat", flat_cents: 7500, pct: 0, daily_cents: 0, max_cents: 7500 });
      else add("late_fee_policies", { id: `lfp-${p.id}`, property_id: p.id, grace_days: 3, kind: "Flat + daily", flat_cents: 5000, pct: 0, daily_cents: 1000, max_cents: 15000 });
    }
    const rules: [string, string, string, string, string, string | null][] = [
      ["TX", "late_fee_cap_pct", "10", "Tex. Prop. Code §92.019: fee is reasonable if ≤ 12% of monthly rent (structures with ≤ 4 units) or ≤ 10% (more than 4 units). Rent must remain unpaid two full days after the due date.", "2019-09-01", null],
      ["TX", "grace_days", "2", "No late fee until rent has remained unpaid two full days after it was due.", "2019-09-01", null],
      ["TX", "deposit_return_days", "30", "Refund or itemized deductions within 30 days after surrender (§92.103).", "2015-01-01", null],
      ["TX", "notice_days", "3", "Notice to vacate before filing eviction for nonpayment, unless the lease sets a shorter period.", "2015-01-01", null],
      ["GA", "late_fee_cap_pct", "0", "No statutory cap; the fee must be stated in the lease and be reasonable.", "2015-01-01", null],
      ["GA", "grace_days", "5", "Company policy; Georgia sets no statutory grace period.", "2015-01-01", null],
      ["GA", "deposit_max_months", "none", "No statutory maximum.", "2015-01-01", null],
      ["GA", "deposit_max_months", "2", "Safe at Home Act (HB 404): security deposit may not exceed two months' rent.", "2024-07-01", "sam"],
      ["GA", "notice_days", "3", "Safe at Home Act: 3-business-day notice to pay or vacate before filing a dispossessory.", "2024-07-01", "sam"],
      ["GA", "deposit_return_days", "30", "Return within one month after termination (O.C.G.A. §44-7-34).", "2015-01-01", null],
      ["AZ", "late_fee_cap_pct", "0", "No statutory cap; the fee must be in the lease and reasonable (A.R.S. §33-1368).", "2015-01-01", null],
      ["AZ", "grace_days", "3", "Company policy; Arizona sets no statutory grace period.", "2015-01-01", null],
      ["AZ", "deposit_max_months", "1.5", "Deposit and prepaid rent may not exceed 1.5 months' rent (A.R.S. §33-1321).", "2015-01-01", null],
      ["AZ", "deposit_return_days", "14", "Return within 14 business days after termination and delivery of possession.", "2015-01-01", null],
      ["AZ", "notice_days", "5", "Five-day notice for nonpayment of rent.", "2015-01-01", null],
      ["TX", "late_fee_cap_pct", "12", "Applies to properties of 4 units or fewer (Elm Street Duplex Portfolio).", "2026-02-01", "grace"],
    ];
    rules.forEach(([state, rule, value, note, from, by], i) => add("state_rules", { id: `sr-${i + 1}`, state, rule: rule === "late_fee_cap_pct" && value === "12" ? "late_fee_cap_pct_small" : rule, value, note, effective_from: from, changed_by: by }));
    const ap: [string | null, string, number | null, string, number | null, number][] = [
      [null, "Maintenance spend", 75_000, "property_manager", 250_000, 0],
      [null, "Bill payment", 500_000, "accountant", null, 0],
      [null, "Concession", 50_000, "regional_manager", null, 0],
      [null, "Write-off", 0, "accountant", null, 0],
      [null, "Legal", null, "principal", null, 1],
      [null, "Safety", null, "maintenance_supervisor", null, 1],
      [null, "Owner distribution", null, "accountant", null, 0],
      ["oe01", "Maintenance spend", 50_000, "property_manager", 250_000, 0],
      ["oe04", "Maintenance spend", 100_000, "property_manager", 500_000, 0],
      ["oe07", "Bill payment", 1_000_000, "accountant", 2_500_000, 0],
    ];
    ap.forEach(([oe, category, limit, role, ownerOver, human]) => add("approval_policies", { id: `pol-${oe ?? "org"}-${category.toLowerCase().replace(/ /g, "-")}`, owner_entity_id: oe, category, limit_cents: limit, approver_role: role, owner_approval_over_cents: ownerOver, always_human: human }));
  }

  // -------------------------------------------------------------------------------------------
  leasing() {
    const { add, c } = this;
    const SOURCES: [string, number][] = [["Zillow", 26], ["Apartments.com", 24], ["Website", 22], ["Walk-in", 8], ["Referral", 10], ["Google", 10]];
    const SHOW_KINDS: [string, number][] = [["In person", 60], ["Self-guided", 25], ["Virtual", 15]];
    let apl = 1;
    // Applicant persona first: Priyanka Rao at Barton Creek Commons, application started, fee unpaid.
    const p02 = c.propById.p02;
    const pUnit = p02.units.find((u) => u.status === "Vacant" && u.beds === 2) ?? p02.units.find((u) => u.status === "Vacant")!;
    add("prospects", { id: "pr-p02-priyanka", property_id: "p02", name: "Priyanka Rao", email: "priyanka.rao@mail.example", phone: "(737) 555-0142", source: "Website", stage: "Applied", desired_beds: 2, desired_move_in: iso(ASOF + 24), budget_cents: 210_000, assigned_to: "lena", last_contact_at: ts(ASOF - 1, 960), created_at: ts(ASOF - 9, 700) });
    add("applicants", { id: "apl-0001", prospect_id: "pr-p02-priyanka", first_name: "Priyanka", last_name: "Rao", email: "priyanka.rao@mail.example", phone: "(737) 555-0142", monthly_income_cents: 742_000, employer: "Meridian Health Systems", created_at: ts(ASOF - 2, 1210) });
    add("applications", { id: "app-0001", property_id: "p02", unit_id: pUnit.id, listing_id: `lst-${pUnit.id}`, applicant_id: "apl-0001", co_applicants: "[]", stage: "Started", desired_move_in: iso(ASOF + 24), rent_cents: pUnit.market, income_to_rent: Math.round((742_000 / pUnit.market) * 100) / 100, score: null, scoring_factors: "[]", recommendation: null, decided_by: null, decided_at: null, fee_paid: 0, submitted_at: null });
    this.task({ title: "Follow up: Priyanka Rao hasn't finished her application", detail: "Paystubs and the $55 application fee are still outstanding.", entity: ["applications", "app-0001"], property: "p02", assignee: "lena", due: ASOF, created: ASOF - 1, source: "Agent", queue: "needs_you" });

    for (const p of c.props) {
      if (p.kind === "com") continue;
      const r = rng(`leasing:${p.id}`);
      const res = p.units.filter((u) => !u.commercial);
      // Listings for vacant, make-ready and notice units, with price history.
      for (const u of res.filter((u) => ["Vacant", "Make-ready", "Notice"].includes(u.status))) {
        const id = `lst-${u.id}`;
        const listed = ASOF - r.int(3, u.status === "Notice" ? 25 : 70);
        const cuts = ASOF - listed > 30 ? r.int(1, 2) : 0;
        let rent = round(u.market * (1 + cuts * 0.02), 500);
        add("listing_price_history", { id: `lph-${id}-0`, listing_id: id, property_id: p.id, rent_cents: rent, changed_on: iso(listed), reason: "Initial list price" });
        for (let i = 1; i <= cuts; i++) {
          rent = round(rent * 0.98, 500);
          add("listing_price_history", { id: `lph-${id}-${i}`, listing_id: id, property_id: p.id, rent_cents: rent, changed_on: iso(listed + i * 14), reason: i === 1 ? "Price cut: 21+ days on market" : "Price cut: matched comps (Renewals agent)" });
        }
        const views = r.int(80, 900);
        add("listings", {
          id, property_id: p.id, unit_id: u.id, headline: `${u.beds ? `${u.beds}-bed` : "Studio"} ${u.beds ? `${u.baths}-bath ` : ""}at ${p.name} — ${u.sqft} sq ft`, rent_cents: rent, available_on: u.row.available_on as string,
          description: `Bright ${u.beds ? `${u.beds}-bedroom` : "studio"} home on floor ${u.floor} at ${p.name} in ${p.metro}. ${u.sqft} sq ft with in-unit laundry, ${p.cls === "A" ? "quartz counters and stainless appliances" : "updated kitchen and new flooring"}. ${p.pool ? "Pool, " : ""}fitness center and package lockers on site.`,
          status: u.status === "Notice" && r.chance(0.3) ? "Draft" : r.chance(0.06) ? "Paused" : "Active", syndication: JSON.stringify({ zillow: "Live", apartments: r.chance(0.9) ? "Live" : "Pending", website: "Live", facebook: r.chance(0.5) ? "Live" : "Off" }),
          photos: JSON.stringify(["living", "kitchen", "bedroom", "bathroom"].map((room) => `/img/units/unit-${p.cls.toLowerCase()}-${room}.webp`).concat([`/img/props/${p.id}.webp`])), views, leads: Math.round(views * (0.03 + r() * 0.04)), listed_on: iso(listed),
        });
      }
      // Prospects over the last 6 months, sized to the property's vacancy and turnover.
      const monthly = Math.max(6, Math.round(res.length * 0.11));
      const agent = p.agent;
      for (let m = 0; m < 6; m++) {
        const period = addMonths("2026-11", -m);
        const count = m === 0 ? Math.round(monthly * 0.2) : monthly;
        for (let i = 0; i < count; i++) {
          const created = Math.min(ASOF, monthStart(period) + r.int(0, 29));
          const age = ASOF - created;
          const stage = age < 3 ? r.weighted([["Inquiry", 60], ["Contacted", 30], ["Tour scheduled", 10]] as const) : age < 14 ? r.weighted([["Contacted", 25], ["Tour scheduled", 25], ["Toured", 25], ["Applied", 15], ["Lost", 10]] as const) : r.weighted([["Lost", 45], ["Leased", 25], ["Toured", 12], ["Applied", 8], ["Contacted", 10]] as const);
          const nm = `${pick(r, FIRST)} ${pick(r, LAST)}`;
          const id = `pr-${p.id}-${String(this.n(`pr${p.id}`)).padStart(4, "0")}`;
          const corruptEmail = r.chance(0.025);
          const lastContact = stage === "Inquiry" ? null : created + r.int(0, Math.min(age, 6));
          add("prospects", {
            id, property_id: p.id, name: nm, email: `${nm.toLowerCase().replace(/[^a-z]/g, ".")}@${corruptEmail ? "gmial,com" : "mail.example"}`, phone: `(${p.metro === "Atlanta" ? 470 : p.metro === "Phoenix" ? 623 : 512}) 555-${r.int(1000, 9999)}`,
            source: r.weighted(SOURCES), stage, desired_beds: r.weighted([[0, 8], [1, 45], [2, 35], [3, 12]] as const), desired_move_in: iso(created + r.int(14, 60)), budget_cents: round(p.units[0].market * (0.9 + r() * 0.5), 5000),
            assigned_to: agent, last_contact_at: lastContact === null ? null : ts(lastContact, 600 + r.int(0, 420)), created_at: ts(created, 480 + r.int(0, 600)),
          });
          if (corruptEmail) (c.planted["prospects.invalid_email"] ??= []).push(id);
          if (["Tour scheduled", "Toured", "Applied", "Leased"].includes(stage)) {
            const unit = pick(r, res);
            const when = stage === "Tour scheduled" ? (m === 0 && r.chance(0.5) ? ASOF : ASOF + r.int(1, 5)) : created + r.int(1, 5);
            add("showings", { id: `sh-${id}`, property_id: p.id, unit_id: unit.id, prospect_id: id, agent_id: agent, kind: r.weighted(SHOW_KINDS), scheduled_at: ts(when, 600 + r.int(0, 14) * 30), status: when > ASOF || (when === ASOF && stage === "Tour scheduled") ? "Scheduled" : r.chance(0.08) ? "No-show" : "Completed", feedback: stage === "Toured" ? pick(r, ["Loved the kitchen; worried about parking.", "Comparing with two other communities.", "Wants a higher floor.", "Ready to apply this week.", "Price is at the top of budget."]) : "" });
          }
          if (stage === "Applied" || (stage === "Leased" && r.chance(0.7))) {
            const aid = `apl-${String(++apl).padStart(4, "0")}`;
            const [first, last] = nm.split(" ");
            const unit = pick(r, res);
            const income = round(unit.market * (2.4 + r() * 2), 1000);
            add("applicants", { id: aid, prospect_id: id, first_name: first, last_name: last, email: `${first}.${last}`.toLowerCase() + "@mail.example", phone: `(512) 555-${r.int(1000, 9999)}`, monthly_income_cents: income, employer: pick(r, ["Dell Technologies", "St. David's HealthCare", "Delta Air Lines", "Banner Health", "City of Dallas", "Emory University", "Intel", "H-E-B", "Home Depot", "Self-employed"]), created_at: ts(created + 2, 900) });
            this.application(p, unit, aid, income, stage === "Leased" ? "Leased" : age < 4 ? "Submitted" : r.weighted([["Screening", 30], ["Review", 40], ["Approved", 15], ["Conditional", 8], ["Denied", 7]] as const), created + 2, r);
          }
        }
      }
    }
    // Recent new leases link to an application (the funnel ends in a lease).
    for (const l of c.leases) {
      if (l.renewalOf || l.commercial || l.start < ASOF - 120 || l.status === "Expired") continue;
      const r = rng(`app:${l.id}`);
      const aid = `apl-${String(++apl).padStart(4, "0")}`;
      const primary = l.hh.residents[0];
      if (!primary) continue;
      const income = round(l.rent * (2.6 + r() * 1.8), 1000);
      add("applicants", { id: aid, prospect_id: null, first_name: primary.first_name, last_name: primary.last_name, email: primary.email, phone: primary.phone, monthly_income_cents: income, employer: pick(r, ["Apple", "Tesla Giga Texas", "Oracle", "Southwest Airlines", "Piedmont Healthcare", "Honor Health", "UT Austin", "Freelance designer"]), created_at: ts(l.start - 20, 700) });
      const app = this.application(l.u.p, l.u, aid, income, "Leased", l.start - 20, r);
      l.row.application_id = app;
    }
    // Renewal offers: history for renewed leases this year, open offers for leases ending soon.
    const renewedBy = new Map(c.leases.filter((x) => x.renewalOf).map((x) => [x.renewalOf!, x]));
    for (const l of c.leases) {
      if (l.commercial) continue;
      const r = rng(`renew:${l.id}`);
      const next = renewedBy.get(l);
      if (next && next.start > ASOF - 300) {
        const sent = l.end! - r.int(60, 90);
        const v1 = round(l.rent * 1.045, 500);
        const countered = r.chance(0.3);
        this.add("renewal_offers", { id: `ro-${l.id}-1`, lease_id: l.id, property_id: l.u.p.id, version: 1, term_months: 12, rent_cents: v1, current_rent_cents: l.rent, market_rent_cents: l.u.market, status: countered ? "Countered" : "Accepted", sent_at: ts(sent, 600), responded_at: ts(sent + r.int(3, 20), 800), expires_on: iso(sent + 30) });
        if (countered) this.add("renewal_offers", { id: `ro-${l.id}-2`, lease_id: l.id, property_id: l.u.p.id, version: 2, term_months: 12, rent_cents: next.rent, current_rent_cents: l.rent, market_rent_cents: l.u.market, status: "Accepted", sent_at: ts(sent + 22, 600), responded_at: ts(sent + 26, 800), expires_on: iso(sent + 50) });
      }
      if (["Active", "Month-to-month"].includes(l.status) && l.end !== null && l.end - ASOF < 120 && l.end - ASOF > -400) {
        const daysLeft = l.end - ASOF;
        const sent = daysLeft < 90 && r.chance(0.7);
        const rent = round(l.rent * (1 + (l.u.market > l.rent ? 0.035 : 0.01)), 500);
        this.add("renewal_offers", { id: `ro-${l.id}-open`, lease_id: l.id, property_id: l.u.p.id, version: 1, term_months: r.pick([12, 12, 13, 15]), rent_cents: rent, current_rent_cents: l.rent, market_rent_cents: l.u.market, status: sent ? (r.chance(0.2) ? "Countered" : "Sent") : "Draft", sent_at: sent ? ts(ASOF - r.int(2, 30), 600) : null, responded_at: null, expires_on: iso(Math.max(ASOF + 5, (l.end ?? ASOF) - 30)) });
      }
    }
    // Concessions: lease-level (from the ledger) and property-wide specials, some awaiting approval.
    for (const l of c.leases) if (l.concession) this.add("concessions", { id: `con-${l.id}`, property_id: l.u.p.id, lease_id: l.id, label: l.concession.label, amount_cents: l.concession.monthly * l.concession.months.length, months: JSON.stringify(l.concession.months), approved_by: regional(l.u.p), status: l.concession.months.at(-1)! < "2026-11" ? "Expired" : "Active" });
    const specials: [string, string, number, string][] = [["p09", "Winter special: 4 weeks free on 2-beds", 180_000, "Proposed"], ["p11", "Look & lease: $750 off move-in", 75_000, "Proposed"], ["p04", "Waived admin fee through December", 25_000, "Proposed"], ["p16", "6 weeks free on 13-month leases", 240_000, "Active"], ["p28", "Renovated units: first month half off", 60_000, "Active"], ["p30", "Holiday special: $500 off", 50_000, "Proposed"]];
    for (const [pid, label, amount, status] of specials) this.add("concessions", { id: `con-${pid}-special`, property_id: pid, lease_id: null, label, amount_cents: amount, months: JSON.stringify(["2026-11", "2026-12"]), approved_by: status === "Active" ? regional(c.propById[pid]) : null, status });
    // Renters insurance on current leases; some lapsed or waived.
    for (const l of this.currentLeases()) {
      if (l.commercial) continue;
      const r = rng(`ri:${l.id}`);
      const exp = l.start + 365 + r.int(-20, 40);
      const lapsed = r.chance(0.06);
      this.add("renters_insurance", { id: `rins-${l.id}`, lease_id: l.id, property_id: l.u.p.id, carrier: pick(r, RENTERS_CARRIERS), policy_number: `${pick(r, ["LMN", "SF", "ASR", "ALL", "TGL", "USA"])}-${r.int(1000000, 9999999)}`, liability_cents: r.pick([10_000_000, 30_000_000]), starts_on: iso(l.start), expires_on: iso(lapsed ? ASOF - r.int(5, 60) : Math.max(exp, ASOF + r.int(5, 300))), status: lapsed ? "Lapsed" : r.chance(0.02) ? "Waived" : exp - ASOF < 30 && exp > ASOF ? "Expiring" : "Active" });
    }
  }

  application(p: Prop, unit: Unit, applicantId: string, income: number, stage: string, submitted: number, r: Rng) {
    const id = `app-${String(this.n("app") + 1).padStart(4, "0")}`;
    const itr = Math.round((income / unit.market) * 100) / 100;
    const credit = r.weighted([["Excellent", 25], ["Good", 40], ["Fair", 22], ["Thin file", 8], ["Poor", 5]] as const);
    const eviction = r.chance(0.03);
    const factors = [
      { factor: "Income to rent", direction: itr >= 3 ? "+" : "-", weight: 0.4, detail: `Income is ${itr}× the monthly rent (policy: 3×)` },
      { factor: "Credit band", direction: credit === "Excellent" || credit === "Good" ? "+" : "-", weight: 0.3, detail: `Screening credit band: ${credit}` },
      { factor: "Rental history", direction: eviction ? "-" : "+", weight: 0.3, detail: eviction ? "Prior eviction filing found (2021)" : "No evictions; prior landlord reference verified" },
    ];
    const score = Math.max(5, Math.min(98, Math.round(40 + (itr - 3) * 18 + (credit === "Excellent" ? 25 : credit === "Good" ? 15 : credit === "Fair" ? 0 : -15) - (eviction ? 30 : 0) + r.int(-5, 5))));
    const rec = score >= 70 ? "Approve" : score >= 50 ? "Conditional" : "Deny";
    const decided = ["Approved", "Conditional", "Denied", "Leased"].includes(stage);
    this.add("applications", {
      id, property_id: p.id, unit_id: unit.id, listing_id: this.t.listings?.some((l) => l.unit_id === unit.id) ? `lst-${unit.id}` : null, applicant_id: applicantId, co_applicants: "[]", stage,
      desired_move_in: iso(submitted + r.int(10, 40)), rent_cents: unit.market, income_to_rent: itr, score: stage === "Submitted" ? null : score, scoring_factors: stage === "Submitted" ? "[]" : JSON.stringify(factors),
      recommendation: stage === "Submitted" ? null : rec, decided_by: decided ? "rachel" : null, decided_at: decided ? ts(submitted + r.int(1, 4), 840) : null, fee_paid: 1, submitted_at: ts(submitted, 780),
    });
    if (stage !== "Submitted") this.add("screening_results", { id: `scr-${id}`, application_id: id, applicant_id: applicantId, property_id: p.id, provider: "Sample Screening Co.", credit_band: credit, score: 520 + Math.round(score * 3), eviction_found: eviction ? 1 : 0, criminal_flag: 0, income_verified: itr >= 2.5 ? 1 : 0, decision: rec === "Approve" ? "Pass" : rec === "Conditional" ? "Conditional" : "Fail", completed_at: ts(submitted + 1, 660) });
    return id;
  }

  // -------------------------------------------------------------------------------------------
  operations() {
    const { add, c } = this;
    const PM: [string, string, string, string[]][] = [
      ["HVAC filter change", "HVAC", "Quarterly", ["Replace return-air filters", "Check condensate line", "Log filter size"]],
      ["Fire extinguisher inspection", "Life safety", "Annual", ["Check gauge pressure", "Verify tag date", "Replace missing pins"]],
      ["Smoke detector test", "Life safety", "Semiannual", ["Test every unit detector", "Replace batteries", "Note failed units"]],
      ["Backflow preventer test", "Plumbing", "Annual", ["Certified tester on site", "File report with city"]],
      ["Roof inspection", "Roofing", "Semiannual", ["Inspect flashing", "Clear drains", "Photograph membrane"]],
      ["Gutter cleaning", "Grounds", "Semiannual", ["Clear gutters and downspouts", "Check splash blocks"]],
      ["Dryer vent cleaning", "Life safety", "Annual", ["Clean all dryer vents", "Record lint volume"]],
      ["Pool chemical log review", "Pool", "Monthly", ["Review daily logs", "Test chlorine and pH", "Check safety equipment"]],
      ["Elevator safety inspection", "Elevator", "Annual", ["State inspector visit", "Post certificate in cab"]],
      ["Parking lot sweep", "Grounds", "Monthly", ["Sweep lot", "Check light poles"]],
    ];
    for (const p of c.props) {
      const r = rng(`pm:${p.id}`);
      const sched = PM.filter(([nm]) => (nm.includes("Pool") ? p.pool : nm.includes("Elevator") ? p.stories >= 4 : nm.includes("Dryer") || nm.includes("Smoke") ? p.kind !== "com" : true));
      for (const [nm, cat, freq, steps] of sched) {
        const id = `pms-${p.id}-${nm.toLowerCase().replace(/[^a-z]+/g, "-")}`;
        const months = freq === "Monthly" ? 1 : freq === "Quarterly" ? 3 : freq === "Semiannual" ? 6 : 12;
        const next = ASOF + r.int(-6, months * 30);
        add("pm_schedules", { id, property_id: p.id, name: nm, category: cat, frequency: freq, next_due_on: iso(next), vendor_id: cat === "HVAC" ? p.vendors.HVAC : cat === "Elevator" ? "v22" : cat === "Pool" ? "v20" : cat === "Roofing" ? p.vendors.Roofing : null, assignee_id: p.techs[0] ?? null, checklist: JSON.stringify(steps), active: 1 });
        // The latest occurrence of each schedule as a preventive work order.
        if (next - months * 30 > ASOF - 400) {
          const opened = Math.min(ASOF, next - months * 30 + (next < ASOF ? months * 30 : 0));
          const wo = createWorkOrder(c, p, null, ["General", nm, "General", 5_000, 25_000, null], opened, `WO-${++c.woN}`, r, "Preventive", { pm: id, title: `${nm} (preventive)` });
          wo.vendor_id = null;
          wo.cost_cents = wo.completed_at ? round(r.int(2_000, 9_000), 100) : null;
        }
      }
      // Keys, key log and shop inventory.
      const keys = [`Master ${p.id.toUpperCase()}`, "Pool gate", "Leasing office", "Maintenance shop", "Mechanical room", ...p.units.slice(0, 6).map((u) => `Unit ${u.number} front`)];
      keys.forEach((label, i) => {
        const kid = `key-${p.id}-${i + 1}`;
        const out = r.chance(0.25);
        const holder = out ? (r.chance(0.6) ? p.techs[0] ?? p.manager : p.vendors.Plumbing) : null;
        add("keys", { id: kid, property_id: p.id, unit_id: label.startsWith("Unit") ? p.units[i - 5]?.id ?? null : null, label, kind: i === 0 ? "Key" : r.weighted([["Key", 60], ["Fob", 30], ["Code", 10]] as const), holder_kind: holder ? (holder.startsWith("v") ? "vendor" : "staff") : null, holder_id: holder });
        if (holder) add("key_log", { id: `kl-${kid}`, key_id: kid, property_id: p.id, action: "Checked out", holder_kind: holder.startsWith("v") ? "vendor" : "staff", holder_id: holder, work_order_id: null, at: ts(ASOF - r.int(0, 9), 540 + r.int(0, 400)) });
      });
      if (r.chance(0.2)) add("key_log", { id: `kl-${p.id}-lost`, key_id: `key-${p.id}-3`, property_id: p.id, action: "Lost", holder_kind: "staff", holder_id: p.techs[0] ?? p.manager, work_order_id: null, at: ts(ASOF - r.int(20, 60), 900) });
      const INV: [string, string, string, number][] = [["HVAC-F2025", "Air filter 20x25x1", "HVAC", 650], ["PLB-WAX", "Toilet wax ring", "Plumbing", 450], ["PLB-FLAP", "Toilet flapper", "Plumbing", 700], ["ELC-GFCI", "GFCI outlet 20A", "Electrical", 1890], ["APP-DISP", "Disposal 1/2 HP", "Appliance", 11900], ["LCK-KW", "Kwikset entry lever", "Locks", 3400], ["PNT-WHT", "Paint, flat white (gal)", "Paint", 2800], ["LGT-LED", "LED bulb A19 (4-pack)", "Lighting", 1100]];
      if (p.kind !== "com") for (const [sku, nm, cat, cost] of INV) { const onHand = r.int(0, 40); add("inventory_items", { id: `inv-${p.id}-${sku}`, property_id: p.id, sku, name: nm, category: cat, on_hand: onHand, reorder_at: 6, unit_cost_cents: cost }); }
    }
    // Service requests from residents: the portal request behind each recent resident work order.
    for (const w of c.workOrders) {
      if (w.source !== "Resident" || !w.unit_id || (w.opened_at as string) < iso(ASOF - 60)) continue;
      const u = c.unitById[w.unit_id as string];
      const res = u.leases.find((l) => CURRENT.has(l.status))?.hh.residents[0];
      if (!res) continue;
      const id = `sr-${w.id}`;
      add("service_requests", { id, property_id: w.property_id, unit_id: w.unit_id, resident_id: res.id, body: `${w.title}. ${pick(rng(id), ["It started last night.", "Please come when I'm home after 5.", "This is the second time this month.", "Okay to enter with the master key.", "Photo attached."])}`, category: w.category, urgency: w.priority, status: "Converted", work_order_id: w.id, submitted_at: w.opened_at });
      w.service_request_id = id;
    }
    // Inspections: move-in/move-out in the last 4 months, annual unit inspections, property safety.
    let insp = 0;
    for (const l of c.leases) {
      if (l.commercial) continue;
      for (const [kind, d] of [["Move-in", l.start], ["Move-out", l.moveOut]] as const) {
        if (!d || d < ASOF - 120 || d > ASOF + 14) continue;
        this.inspection(l.u, kind, d, ++insp);
      }
    }
    for (const p of c.props) {
      const r = rng(`insp:${p.id}`);
      this.inspection(null, "Safety", ASOF - r.int(10, 80), ++insp, p);
      this.inspection(null, p.kind === "com" ? "Quarterly" : "Insurance", ASOF + r.int(2, 40), ++insp, p);
      for (const u of p.units.filter((_, i) => i % 23 === 0)) this.inspection(u, "Annual", ASOF - r.int(-20, 200), ++insp);
    }
    // Ratings on completed work orders.
    for (const w of c.workOrders) {
      if (!w.completed_at || w.source !== "Resident" || (w.completed_at as string) < iso(ASOF - 150)) continue;
      const r = rng(`rate:${w.id}`);
      if (!r.chance(0.35)) continue;
      const stars = r.weighted([[5, 52], [4, 28], [3, 10], [2, 6], [1, 4]] as const);
      add("ratings", { id: `rt-${w.id}`, by_kind: "resident", by_id: c.unitById[w.unit_id as string]?.leases.at(-1)?.hh.residents[0]?.id ?? "unknown", subject_kind: "work_orders", subject_id: w.id, property_id: w.property_id, stars, comment: stars >= 4 ? pick(r, ["Fast and friendly.", "Fixed on the first visit.", "Cleaned up after.", "Great communication."]) : pick(r, ["Took three visits.", "Tech was late.", "Problem came back.", "Left a mess."]), at: ts(day(w.completed_at as string) + 1, 1100) });
    }
    // Capex projects: some over budget, some behind milestones.
    const CAPEX: [string, string, string, number, number, string][] = [
      ["p02", "Roof replacement, buildings 3–5", "Roofing", 48_500_000, 1.12, "In progress"], ["p09", "Pool resurfacing and new deck", "Amenities", 18_500_000, 0.4, "In progress"],
      ["p16", "Interior renovations: 40 units (classic → premium)", "Interiors", 120_000_000, 0.55, "In progress"], ["p28", "Full exterior paint and stair replacement", "Exterior", 64_000_000, 1.18, "In progress"],
      ["p08", "Elevator modernization (2 cabs)", "Elevator", 52_000_000, 0.2, "Approved"], ["p22", "Smart-home package (locks, thermostats)", "Technology", 21_800_000, 1, "Complete"],
      ["p24", "Parking lot resurfacing and restriping", "Exterior", 9_600_000, 0, "Planned"], ["p15", "Lobby and amenity refresh", "Amenities", 34_000_000, 0.92, "In progress"],
      ["p06", "Spec suite build-out (Suite 401)", "Tenant improvements", 26_000_000, 0.7, "In progress"], ["p12", "LED lighting retrofit", "Energy", 7_400_000, 1, "Complete"],
      ["p30", "Clubhouse renovation", "Amenities", 15_500_000, 0, "On hold"], ["p04", "Fence replacement", "Exterior", 4_800_000, 0.15, "Planned"],
    ];
    CAPEX.forEach(([pid, nm, cat, budget, spentPct, status], i) => {
      const r = rng(`capex:${i}`);
      const start = ASOF - r.int(30, 240);
      const target = start + r.int(90, 300);
      const ms = ["Bids and contract", "Permits", "Phase 1", "Phase 2", "Punch list and closeout"].map((m, j) => {
        const due = start + Math.round(((target - start) * (j + 1)) / 5);
        const doneOn = due < ASOF && (spentPct >= (j + 1) / 5 - 0.05 || status === "Complete") ? due + r.int(-5, 15) : null;
        return { name: m, due_on: iso(due), done_on: doneOn && doneOn <= ASOF ? iso(doneOn) : null, pct: (j + 1) * 20 };
      });
      add("capex_projects", { id: `cx-${i + 1}`, property_id: pid, vendor_id: c.propById[pid].vendors["General contractor"], name: nm, category: cat, budget_cents: budget, spent_cents: round(budget * spentPct, 100), status, start_on: status === "Planned" ? null : iso(start), target_on: iso(target), milestones: JSON.stringify(ms) });
    });
  }

  inspection(u: Unit | null, kind: string, d: number, n: number, prop?: Prop) {
    const p = u?.p ?? prop!;
    const r = rng(`inspection:${n}`);
    const id = `insp-${n}`;
    const done = d < ASOF;
    const items: [string, string][] = u ? [["Kitchen", "Range and oven"], ["Kitchen", "Refrigerator"], ["Kitchen", "Sink and faucet"], ["Bath", "Toilet"], ["Bath", "Tub and shower"], ["Living", "Flooring"], ["Living", "Walls and paint"], ["Bedroom", "Smoke detector"]] : [["Exterior", "Fire lanes clear"], ["Exterior", "Exit lighting"], ["Common", "Extinguishers tagged"], ["Common", "Stairwell handrails"], ["Exterior", "Pool gate self-closing"]];
    let failed = 0;
    const rows: R[] = items.map(([area, item], i) => {
      const cond = !done ? "N/A" : r.weighted([["Good", 78], ["Fair", 15], ["Damaged", kind === "Move-out" ? 9 : 4], ["Missing", 1]] as const);
      if (cond === "Damaged" || cond === "Missing") failed++;
      return { id: `${id}-i${i + 1}`, inspection_id: id, property_id: p.id, area, item, condition: cond, note: cond === "Damaged" ? pick(r, ["Burn mark on counter", "Cracked tile", "Large carpet stain", "Hole in drywall", "Detector chirping"]) : "", work_order_id: null };
    });
    const status = !done ? "Scheduled" : failed > 1 && kind !== "Move-out" ? "Failed" : "Completed";
    this.add("inspections", { id, property_id: p.id, unit_id: u?.id ?? null, kind, scheduled_on: iso(d), completed_on: done ? iso(d) : null, inspector_id: kind === "Safety" || kind === "Insurance" ? p.supervisor : p.manager, status, score: done ? Math.max(40, 100 - failed * 12 - r.int(0, 6)) : null });
    for (const row of rows) {
      // A failed item raises a work order.
      if ((row.condition === "Damaged" || row.condition === "Missing") && d > ASOF - 60 && u) {
        const spec = WO_TYPES.find((w) => w[1].toLowerCase().includes(String(row.item).split(" ")[0].toLowerCase())) ?? WO_TYPES[15];
        const wo = createWorkOrder(this.c, p, u, spec, d, `WO-${++this.c.woN}`, r, "Inspection", { title: `${row.item}: ${row.note || "damaged"} (inspection)` });
        row.work_order_id = wo.id as string;
      }
      this.add("inspection_items", row);
    }
    if (done && r.chance(0.5)) this.add("photos", { id: `ph-${id}`, entity_type: "inspection_items", entity_id: rows[0].id as string, property_id: p.id, url: u ? `/img/units/unit-${p.cls.toLowerCase()}-kitchen.webp` : `/img/props/${p.id}.webp`, caption: `${kind} inspection`, stage: "Evidence", taken_at: ts(d, 660), check_result: "Matches", check_confidence: 0.93, check_note: null });
  }

  // -------------------------------------------------------------------------------------------
  // Curated records the personas land on (resident, vendor, owner, applicant, PM, regional…).
  personaScenarios() {
    const { c } = this;
    const r = rng("personas");
    const p01 = c.propById.p01, p02 = c.propById.p02, p03 = c.propById.p03;
    const jordan = c.households.find((h) => h.residents[0]?.id === "res-p01-0001")!;
    const jUnit = jordan.leases.at(-1)!.u;
    // Jordan's AC repair: scheduled for tomorrow with Hill Country HVAC.
    const ac = createWorkOrder(c, p01, jUnit, WO_TYPES[5], ASOF - 1, `WO-${++c.woN}`, r, "Resident", null);
    Object.assign(ac, { status: "Scheduled", vendor_id: "v02", priority: "Urgent", assignee_id: null, scheduled_at: ts(ASOF + 1, 600), completed_at: null, cost_cents: null, title: "AC not cooling", description: "AC not cooling · #412. Thermostat set to 72, unit reads 81. Resident works from home; okay to enter 9–12." });
    this.add("service_requests", { id: `sr-${ac.id}`, property_id: "p01", unit_id: jUnit.id, resident_id: "res-p01-0001", body: "My AC is blowing warm air. Thermostat says 81 even set to 72. I work from home so mornings are best.", category: "HVAC", urgency: "Urgent", status: "Converted", work_order_id: ac.id, submitted_at: ac.opened_at });
    this.add("wo_events", { id: `${ac.id}-sched`, work_order_id: ac.id, property_id: "p01", at: ts(ASOF - 1, 700), actor_kind: "vendor", actor_id: "v02", kind: "Status", status: "Scheduled", detail: JSON.stringify({ window: "Tomorrow 9:00–11:00" }) });
    // Lone Star Plumbing (vendor persona): assigned and submitted jobs across Austin and Dallas.
    const v01Jobs: [Prop, string, number][] = [[p01, "Assigned", 0], [p02, "Scheduled", 0], [p02, "Submitted", 1], [p03, "Submitted", 2], [c.propById.p09, "In progress", 0], [p01, "Submitted", 0]];
    for (const [p, status, k] of v01Jobs) {
      const u = p.units.find((x, i) => x.status === "Occupied" && i % 7 === k + 3)!;
      const spec = WO_TYPES[k % 5];
      const w = createWorkOrder(c, p, u, spec, ASOF - r.int(1, 4), `WO-${++c.woN}`, r, "Resident", null);
      const cost = round(spec[3] + r() * (spec[4] - spec[3]), 100);
      Object.assign(w, { status, vendor_id: "v01", assignee_id: null, completed_at: null, cost_cents: null, estimate_cents: cost, scheduled_at: status === "Assigned" ? null : ts(ASOF + (status === "Scheduled" ? 1 : -1), 600) });
      if (status === "Submitted") this.add("wo_events", { id: `${w.id}-sub`, work_order_id: w.id, property_id: p.id, at: ts(ASOF, 540), actor_kind: "vendor", actor_id: "v01", kind: "Submission", status: "Submitted", detail: JSON.stringify({ total_cents: cost, invoice_number: `LSP-${r.int(40000, 49999)}`, lines: [{ description: "Labor (2 hrs)", amount_cents: round(cost * 0.55, 100) }, { description: "Parts", amount_cents: cost - round(cost * 0.55, 100) }] }) });
    }
    // Owner persona: a repair above the owner's approval limit, waiting in the owner portal.
    const big = createWorkOrder(c, p02, p02.units.find((u) => u.status === "Occupied" && u.beds >= 2)!, WO_TYPES[3], ASOF - 2, `WO-${++c.woN}`, r, "Resident", null);
    Object.assign(big, { status: "On hold", vendor_id: "v01", estimate_cents: 485_000, cost_cents: null, completed_at: null, title: "Water heater failed — replace 50-gal unit", description: "Tank leaking at the base; replacement quoted at $4,850 including haul-away and permit. Over the owner approval limit ($2,500)." });
    this.task({ title: "Owner approval needed: water heater replacement $4,850", detail: "Over Bluebonnet's $2,500 owner approval limit. Sent to Helen Carter in the owner portal.", entity: ["work_orders", big.id as string], property: "p02", assignee: null, role: "owner", due: ASOF + 1, created: ASOF - 1, queue: "waiting", source: "Agent" });
    this.add("notifications", { id: `nt-owner-approve-${big.id}`, user_id: "ow01", channel: "In-app", title: "Approval needed: $4,850 repair at Barton Creek Commons", body: "Water heater replacement is over your $2,500 approval limit.", href: "/portal/owner/approvals", entity_type: "work_orders", entity_id: big.id, read_at: null, at: ts(ASOF - 1, 610) });
    // Past-SLA emergencies for Tom's board in Texas.
    for (const pid of ["p08", "p09", "p11"]) {
      const p = c.propById[pid];
      const w = createWorkOrder(c, p, p.units.find((u) => u.status === "Occupied")!, WO_TYPES[4], ASOF - 2, `WO-${++c.woN}`, r, "Resident", null);
      Object.assign(w, { status: "In progress", priority: "Emergency", completed_at: null, cost_cents: null, sla_due_at: ts(ASOF - 2, 900) });
    }
  }

  // -------------------------------------------------------------------------------------------
  documents() {
    const { add, c } = this;
    let n = 0;
    const doc = (d: R) => add("documents", { id: `doc-${++n}`, mime: "application/pdf", classify_confidence: null, filed_to: null, classified_by: null, extracted: null, uploaded_by: null, ...d });
    for (const l of c.leases) {
      if (l.status === "Expired" && l.start < ASOF - 200) continue;
      const d = doc({ property_id: l.u.p.id, entity_type: "leases", entity_id: l.id, name: `${l.commercial ? "Commercial lease" : "Lease agreement"} ${l.id} — ${l.hh.name}.pdf`, url: `/docs/leases/${l.id}.pdf`, doc_type: "Lease", classify_confidence: 0.97, filed_to: `Lease ${l.id} › Documents`, classified_by: "document_classifier", extracted: JSON.stringify({ rent_cents: l.rent, start_on: iso(l.start), end_on: l.end === null ? null : iso(l.end), deposit_cents: l.deposit }), uploaded_by: l.u.p.agent, uploaded_at: ts(l.start - 5, 700) });
      l.row.document_id = d.id as string;
    }
    for (const b of c.bills.filter((b) => (b.bill_date as string) >= iso(ASOF - 45))) {
      const d = doc({ property_id: b.property_id, entity_type: "bills", entity_id: b.id, name: `${c.vendorName[b.vendor_id as string]} invoice ${b.invoice_number}.pdf`, url: `/docs/invoices/${b.id}.pdf`, doc_type: "Invoice", classify_confidence: 0.95, filed_to: `Bill ${b.id}`, classified_by: "ap", extracted: JSON.stringify({ vendor: c.vendorName[b.vendor_id as string], invoice_number: b.invoice_number, total_cents: b.amount_cents, invoice_date: b.bill_date }), uploaded_by: "s-lucy", uploaded_at: ts(day(b.bill_date as string) + 1, 600) });
      b.document_id = d.id as string;
    }
    for (const [id, company, , , , is1099] of VENDORS) if (is1099) doc({ property_id: null, entity_type: "vendors", entity_id: id, name: `${company} W-9.pdf`, url: `/docs/vendors/${id}-w9.pdf`, doc_type: "W-9", classify_confidence: 0.99, filed_to: `${company} › Tax forms`, classified_by: "document_classifier", uploaded_by: "s-lucy", uploaded_at: "2026-01-12T16:00:00Z" });
    // Corrupted: an imported rent roll where first/last name and rent/deposit columns were swapped.
    const imp = doc({ property_id: "p30", entity_type: "properties", entity_id: "p30", name: "Glendale Commons rent roll (import 2026-10-18).csv", url: "/docs/imports/glendale-rent-roll.csv", mime: "text/csv", doc_type: "Rent roll import", classify_confidence: 0.88, filed_to: "Glendale Commons › Imports", classified_by: "document_classifier", extracted: JSON.stringify({ rows: 180, columns: ["unit", "last_name", "first_name", "deposit", "rent"], sample: [{ unit: "1101", last_name: "Maria", first_name: "Gonzalez", deposit: 128500, rent: 50000 }, { unit: "1102", last_name: "James", first_name: "Okoro", deposit: 131000, rent: 50000 }] }), uploaded_by: "s-jalen", uploaded_at: "2026-10-18T19:20:00Z" });
    (c.planted["documents.import_swapped_columns"] ??= []).push(imp.id as string);
    // Corrupted: a lease filed to a vendor record.
    const mis = doc({ property_id: "p17", entity_type: "vendors", entity_id: "v14", name: "Lease renewal — unit 318.pdf", url: "/docs/misc/lease-318.pdf", doc_type: "Lease", classify_confidence: 0.41, filed_to: "ATL Make-Ready Pros › Documents", classified_by: "s-kofi", uploaded_by: "s-kofi", uploaded_at: "2026-10-29T15:10:00Z" });
    (c.planted["documents.misfiled"] ??= []).push(mis.id as string);
    this.docN = n;
  }

  // -------------------------------------------------------------------------------------------
  communications() {
    const { add, c } = this;
    const TEMPLATES: [string, string, string, string, string, string][] = [
      ["tpl-rent-reminder", "Rent reminder (3 days before)", "SMS", "Collections", "en", "Hi {{first_name}}, rent of {{amount}} for {{unit}} is due {{due_date}}. Pay in the portal: {{portal_link}}"],
      ["tpl-rent-reminder-es", "Recordatorio de renta", "SMS", "Collections", "es", "Hola {{first_name}}, su renta de {{amount}} para {{unit}} vence el {{due_date}}. Pague en el portal: {{portal_link}}"],
      ["tpl-late-notice", "Late notice", "Email", "Collections", "en", "Dear {{first_name}},\n\nOur records show {{amount}} is past due for {{unit}}. A late fee of {{late_fee}} was posted per your lease. Please pay or call us to set up a payment plan."],
      ["tpl-late-notice-es", "Aviso de pago atrasado", "Email", "Collections", "es", "Estimado/a {{first_name}},\n\nNuestros registros muestran un saldo vencido de {{amount}} para {{unit}}. Se aplicó un cargo por pago tardío de {{late_fee}}. Pague o llámenos para un plan de pagos."],
      ["tpl-payment-plan", "Payment plan agreement", "Email", "Collections", "en", "Hi {{first_name}}, attached is the payment plan we discussed: {{installments}}. Reply to confirm."],
      ["tpl-renewal-offer", "Renewal offer", "Email", "Renewals", "en", "Hi {{first_name}}, we'd love to have you stay at {{property}}. Your renewal offer: {{term}} months at {{rent}}. Offer expires {{expires_on}}."],
      ["tpl-renewal-reminder", "Renewal reminder", "SMS", "Renewals", "en", "{{first_name}}, your lease ends {{end_date}}. Your renewal offer is waiting in the portal."],
      ["tpl-wo-scheduled", "Work order scheduled", "SMS", "Maintenance", "en", "{{vendor}} is scheduled for {{window}} to fix: {{title}}. Reply STOP to opt out."],
      ["tpl-wo-completed", "Work order completed", "Email", "Maintenance", "en", "Your request \"{{title}}\" was completed. How did we do? {{rating_link}}"],
      ["tpl-entry-notice", "Notice of entry", "Email", "Notices", "en", "We will enter {{unit}} on {{date}} between {{window}} for {{reason}}."],
      ["tpl-tour-confirm", "Tour confirmation", "SMS", "Leasing", "en", "You're booked to tour {{property}} on {{date}} at {{time}}. Reply C to confirm."],
      ["tpl-tour-followup", "Tour follow-up", "Email", "Leasing", "en", "Thanks for touring {{property}}, {{first_name}}! Apply in 5 minutes: {{apply_link}}"],
      ["tpl-application-received", "Application received", "Email", "Leasing", "en", "We received your application for {{unit}}. Screening usually takes one business day."],
      ["tpl-move-in", "Move-in welcome", "Email", "Leasing", "en", "Welcome home, {{first_name}}! Keys are ready at the leasing office on {{move_in_date}}."],
      ["tpl-deposit-disposition", "Deposit disposition", "Letter", "Notices", "en", "Itemized security deposit statement for {{unit}}: deductions {{deductions}}, refund {{refund}}."],
      ["tpl-coi-request", "COI renewal request", "Email", "Maintenance", "en", "Hi {{contact}}, our records show your certificate of insurance expires {{expires_on}}. Please upload a current COI."],
      ["tpl-owner-statement", "Owner statement ready", "Email", "Notices", "en", "Your {{period}} owner statement for {{entity}} is ready. Distribution: {{amount}}."],
      ["tpl-pool-closure", "Pool closure", "SMS", "Notices", "en", "The pool at {{property}} is closed {{dates}} for maintenance. Thanks for your patience."],
    ];
    for (const [id, nm, channel, category, language, body] of TEMPLATES) add("templates", { id, name: nm, channel, category, language, subject: channel === "Email" ? nm : "", body });
    const ANN: [string, string, string, string, number][] = [
      ["Water shut-off Thursday 9–1", "Plumbers are replacing a main valve in Building 3. Water will be off from 9 a.m. to 1 p.m.", "Sent", "p02", -6],
      ["Pool resurfacing starts Monday", "The pool will be closed for about three weeks while it is resurfaced.", "Sent", "p09", -12],
      ["Holiday package room hours", "The package room will stay open until 9 p.m. from Dec 1 to Jan 5.", "Scheduled", "p01", 20],
      ["Fire alarm testing", "Annual fire alarm testing on Nov 12. Alarms will sound briefly between 10 and 2.", "Scheduled", "p15", 8],
      ["Parking lot restriping", "Please move vehicles from lot B by 8 a.m. Saturday.", "Draft", "p24", 15],
      ["Resident appreciation breakfast", "Coffee and breakfast tacos at the clubhouse, Friday 7–9 a.m.", "Sent", "p03", -3],
      ["New online payment options", "You can now pay by debit card or set up autopay in the resident portal.", "Sent", "all", -40],
      ["Freeze warning: drip your faucets", "Temperatures below 28°F expected tonight. Drip faucets and open cabinet doors.", "Draft", "r-tx", 30],
    ];
    ANN.forEach(([title, body, status, scope, offset], i) => {
      const props = scope === "all" ? c.props.map((p) => p.id) : scope.startsWith("r-") ? c.props.filter((p) => p.region === scope).map((p) => p.id) : [scope];
      add("announcements", { id: `ann-${i + 1}`, title, body, audience: JSON.stringify({ property_ids: props, kinds: ["resident"] }), channels: JSON.stringify(["Email", "SMS", "Portal"]), status, send_at: ts(ASOF + offset, 540), recipients: status === "Sent" ? props.reduce((s, pid) => s + c.propById[pid].units.filter((u) => u.status === "Occupied").length, 0) : 0, created_by: c.propById[props[0]].manager });
    });
    // Message threads: residents (collections, maintenance, renewals), vendors, owners, prospects.
    let th = 0;
    const thread = (p: Prop | null, party: string, partyId: string, subject: string, entity: [string, string] | null, assigned: string, msgs: [string, string, string, string, number, string | null][], status: string) => {
      const id = `th-${++th}`;
      const last = Math.max(...msgs.map((m) => m[4]));
      add("message_threads", { id, property_id: p?.id ?? null, party_kind: party, party_id: partyId, subject, entity_type: entity?.[0] ?? null, entity_id: entity?.[1] ?? null, assigned_to: assigned, status, last_message_at: ts(last, 900), unread: msgs.at(-1)![1] === "in" && status !== "Closed" ? 1 : 0 });
      msgs.forEach(([channel, direction, senderKind, body, d, agent], i) => add("messages", { id: `${id}-m${i + 1}`, thread_id: id, channel, direction, sender_kind: senderKind, sender_id: direction === "in" ? partyId : agent ? agent : assigned, body, template_id: null, drafted_by_agent: agent, sent_at: ts(d, 540 + i * 37) }));
    };
    for (const hh of c.households.filter((h) => (h.profile === "chronic" || h.plan) && h.leases.some((l) => CURRENT.has(l.status)))) {
      const p = hh.p;
      const r = rng(`th:${hh.id}`);
      const primary = hh.residents[0];
      if (!primary) continue;
      const es = primary.language === "es";
      thread(p, "resident", primary.id as string, es ? "Saldo pendiente" : "Past-due balance", ["households", hh.id], p.manager, [
        ["SMS", "out", "agent", es ? `Hola ${primary.first_name}, su saldo vencido es mayor a un mes. ¿Podemos ayudarle con un plan de pagos?` : `Hi ${primary.first_name}, your balance is now more than a month past due. Can we help with a payment plan?`, ASOF - r.int(8, 20), "collections"],
        ["SMS", "in", "resident", es ? "Sí, me redujeron las horas. ¿Puedo pagar en dos partes?" : "Yes — my hours got cut. Can I split it into two payments?", ASOF - r.int(4, 7), null],
        ["Email", "out", "staff", `Absolutely. ${hh.plan ? "Your plan is attached: half on the 15th, the rest with next month's rent." : "I've drafted a plan for you to review."}`, ASOF - r.int(1, 3), null],
      ], hh.plan ? "Waiting" : "Open");
    }
    for (const w of c.workOrders.filter((w) => w.unit_id && (w.opened_at as string) >= iso(ASOF - 21)).slice(0, 260)) {
      const u = c.unitById[w.unit_id as string];
      const primary = u.leases.find((l) => CURRENT.has(l.status))?.hh.residents[0];
      if (!primary) continue;
      const d = day(w.opened_at as string);
      const done = !!w.completed_at;
      thread(u.p, "resident", primary.id as string, w.title as string, ["work_orders", w.id as string], u.p.manager, [
        ["Portal", "in", "resident", `${w.title}. Can someone take a look?`, d, null],
        ["SMS", "out", "agent", `Thanks ${primary.first_name} — we've logged this as ${w.priority === "Emergency" ? "an emergency" : `a ${String(w.priority).toLowerCase()}-priority`} ${String(w.category).toLowerCase()} request (${w.id}). We'll confirm a time shortly.`, d, "maintenance_triage"],
        ...(done ? ([["SMS", "out", "staff", "All fixed — let us know if anything comes back.", Math.min(ASOF, day(w.completed_at as string)), null]] as [string, string, string, string, number, string | null][]) : []),
      ], done ? "Closed" : "Open");
    }
    for (const [id, company] of VENDORS.slice(0, 20)) thread(null, "vendor", id, `${company}: ${pick(rng(id), ["invoice question", "COI renewal", "access codes for next week", "parts on backorder"])}`, ["vendors", id], "s-lucy", [["Email", "out", "staff", "Hi, following up on this — can you send the updated document?", ASOF - 9, null], ["Email", "in", "vendor", "Sending it over today. Thanks for the patience.", ASOF - 7, null]], "Closed");
    thread(c.propById.p02, "owner", "ow01", "October statement question", ["owner_entities", "oe01"], "grace", [["Email", "in", "owner", "Why was the Barton Creek distribution lower in October?", ASOF - 3, null], ["Email", "out", "agent", "October included the $48,500 roof progress payment and higher HVAC repairs in August heat. Draft explanation attached for Grace to review.", ASOF - 2, "owner_reporting"]], "Open");
    for (const pr of (this.t.prospects ?? []).filter((x) => x.stage === "Contacted" || x.stage === "Toured").slice(0, 120)) {
      const d = day(pr.created_at as string);
      thread(c.propById[pr.property_id as string], "prospect", pr.id as string, `Inquiry from ${pr.name}`, ["prospects", pr.id as string], pr.assigned_to as string, [["Email", "in", "prospect", "Hi! Is the 2-bed still available, and do you allow dogs?", d, null], ["Email", "out", "agent", `Yes — two 2-beds are available now, and dogs under 60 lbs are welcome. Would you like to tour this week?`, d, "leasing"]], "Waiting");
    }
  }

  // -------------------------------------------------------------------------------------------
  risk() {
    const { add, c } = this;
    let docN = this.docN;
    for (const [id, company, trade, , , is1099] of VENDORS) {
      if (!is1099) continue;
      const r = rng(`coi:${id}`);
      const expires = id === "v01" ? ASOF + 21 : id === "v23" ? ASOF - 12 : id === "v14" ? ASOF - 40 : ASOF + r.int(-30, 330);
      const status = expires < ASOF ? "Expired" : expires - ASOF <= 30 ? "Expiring" : "Valid";
      const docId = `doc-${++docN}`;
      add("documents", { id: docId, property_id: null, entity_type: "vendors", entity_id: id, name: `${company} certificate of insurance.pdf`, url: `/docs/vendors/${id}-coi.pdf`, mime: "application/pdf", doc_type: "COI", classify_confidence: 0.96, filed_to: `${company} › Insurance`, classified_by: "document_classifier", extracted: JSON.stringify({ carrier: "Hartwell Mutual", expires_on: iso(expires) }), uploaded_by: "s-lucy", uploaded_at: ts(expires - 365, 600) });
      add("vendor_cois", { id: `coi-${id}`, vendor_id: id, document_id: docId, carrier: r.pick(["Hartwell Mutual", "Contractors Shield", "Lone Pine Casualty", "Summit Specialty"]), gl_limit_cents: r.pick([100_000_000, 200_000_000]), workers_comp: trade === "Pest control" || r.chance(0.85) ? 1 : 0, expires_on: iso(expires), status });
    }
    const ITEMS: [string, string, number][] = [["Fire inspection", "Annual fire marshal inspection", 365], ["Permit", "Certificate of occupancy on file", 0], ["Pool license", "Public pool operating permit", 365], ["Elevator cert", "Elevator certificate of operation", 365], ["Backflow", "Backflow test report filed with city", 365], ["Boiler", "Boiler inspection certificate", 365]];
    let ci = 0;
    for (const p of c.props) {
      const r = rng(`comp:${p.id}`);
      for (const [kind, title, every] of ITEMS) {
        if ((kind === "Pool license" && !p.pool) || (kind === "Elevator cert" && p.stories < 4) || (kind === "Boiler" && p.metro !== "Atlanta")) continue;
        const due = every ? ASOF + r.int(-25, 300) : day("2027-06-30");
        const doneOn = due < ASOF && r.chance(0.6) ? due - r.int(1, 10) : null;
        add("compliance_items", { id: `cmp-${++ci}`, property_id: p.id, staff_id: null, kind, title: `${title} — ${p.name}`, due_on: iso(due), completed_on: doneOn ? iso(doneOn) : null, status: doneOn ? "Done" : due < ASOF ? "Overdue" : due - ASOF <= 30 ? "Due soon" : "Open", document_id: null });
      }
    }
    for (const sid of ["marcus", "lena", "s-maria", "s-tyrone", "s-hailey", "s-yusuf", "rachel", "priya"]) {
      const due = ASOF + rng(`fh:${sid}`).int(-10, 120);
      add("compliance_items", { id: `cmp-${++ci}`, property_id: null, staff_id: sid, kind: "Fair housing training", title: `Annual fair housing training — ${c.staffName[sid]}`, due_on: iso(due), completed_on: null, status: due < ASOF ? "Overdue" : due - ASOF <= 30 ? "Due soon" : "Open", document_id: null });
    }
    // Legal: the eviction (Barton Creek), a small-claims case and a fair-housing inquiry.
    const ev = c.households.find((h) => h.evict)!;
    const evLease = ev.leases.find((l) => l.status === "Eviction")!;
    const owed = ev.open.reduce((s, o) => s + Math.max(0, o.rem), 0);
    add("legal_cases", { id: "lc-1", property_id: ev.p.id, lease_id: evLease.id, kind: "Eviction", stage: "Hearing set", balance_cents: owed, attorney: "Gallo & Reyes, PLLC", court: "Travis County Justice of the Peace, Pct. 5", next_date: iso(ASOF + 9), opened_on: iso(ASOF - 34), closed_on: null });
    this.note("legal_cases", "lc-1", "marcus", `Hearing set for ${iso(ASOF + 9)}. ${mention(c, "priya")} the resident called about a payment plan; attorney says we can still accept full payment before the hearing.`, ASOF - 2, ["priya"]);
    const past = c.households.find((h) => h.p.id === "p09" && h.leases.every((l) => l.moveOut && l.moveOut < ASOF - 90) && h.open.some((o) => o.rem > 0)) ?? c.households.find((h) => h.p.id === "p09")!;
    add("legal_cases", { id: "lc-2", property_id: past.p.id, lease_id: past.leases.at(-1)!.id, kind: "Small claims", stage: "Filed", balance_cents: 412_550, attorney: "", court: "Dallas County JP Court, Pct. 1", next_date: iso(ASOF + 30), opened_on: iso(ASOF - 21), closed_on: null });
    add("legal_cases", { id: "lc-3", property_id: "p16", lease_id: null, kind: "Fair housing complaint", stage: "Closed", balance_cents: 0, attorney: "Holloway Law Group", court: "HUD intake", next_date: null, opened_on: "2026-02-10", closed_on: "2026-06-30" });
    this.docN = docN;
  }

  // -------------------------------------------------------------------------------------------
  finance() {
    const { add, c } = this;
    // Purchase orders for larger recent vendor jobs.
    let po = 0;
    for (const w of c.workOrders) {
      if (!w.vendor_id || (w.estimate_cents as number) < 60_000 || (w.opened_at as string) < iso(ASOF - 90)) continue;
      const id = `po-${++po}`;
      const amt = w.estimate_cents as number;
      add("purchase_orders", { id, property_id: w.property_id, vendor_id: w.vendor_id, work_order_id: w.id, number: `PO-${5000 + po}`, status: w.status === "Paid" ? "Closed" : w.completed_at ? "Partially billed" : "Open", total_cents: amt, issued_on: iso(day(w.opened_at as string) + 1), approved_by: amt > 75_000 ? "tom" : null });
      add("po_lines", { id: `${id}-1`, po_id: id, gl_account_id: "gl-6000", description: `Labor: ${w.title}`, qty: 1, unit_cents: round(amt * 0.6, 100), amount_cents: round(amt * 0.6, 100) });
      add("po_lines", { id: `${id}-2`, po_id: id, gl_account_id: "gl-6000", description: "Parts and materials", qty: 1, unit_cents: amt - round(amt * 0.6, 100), amount_cents: amt - round(amt * 0.6, 100) });
      const bill = c.bills.find((b) => b.work_order_id === w.id);
      if (bill) bill.po_id = id;
    }
    // 1099s: vendor payouts per payer entity, 2025 filed, 2026 in draft.
    const by = new Map<string, number>();
    for (const t of c.t.transfers) if (t.kind === "Vendor payout" && t.status === "Cleared") {
      const k = `${t.to_id}|${t.owner_entity_id}|${(t.created as string).slice(0, 4)}`;
      by.set(k, (by.get(k) ?? 0) + (t.amount_cents as number));
    }
    const is1099 = new Set(VENDORS.filter((v) => v[5]).map((v) => v[0]));
    for (const [k, amount] of [...by].sort()) {
      const [v, oe, year] = k.split("|");
      if (!is1099.has(v) || amount < 60_000) continue;
      add("vendor_1099s", { id: `1099-${v}-${oe}-${year}`, vendor_id: v, owner_entity_id: oe, year: Number(year), amount_cents: amount, status: year === "2025" ? "Filed" : "Draft", filed_on: year === "2025" ? "2026-01-28" : null });
    }
    // Bank feed and reconciliations: Oct–Nov feed lines per trust account, matched to transfers.
    let bt = 0;
    const recon = new Map<string, R>();
    for (const t of c.t.transfers) {
      if (!String(t.bank_account_id).endsWith("-trust") || t.status !== "Cleared" || (t.created as string) < "2026-10-01") continue;
      const id = `bt-${++bt}`;
      const sign = t.kind === "Rent" || t.kind === "Other receipt" ? 1 : -1;
      const posted = (t.cleared as string).slice(0, 10);
      if (posted >= AS_OF) continue;
      add("bank_transactions", { id, bank_account_id: t.bank_account_id, posted_on: posted, description: sign > 0 ? `DEPOSIT ${String(t.ref).toUpperCase()}` : `ACH DEBIT ${String(t.to_name).toUpperCase().slice(0, 28)}`, amount_cents: sign * (t.amount_cents as number), transfer_id: t.id });
      const period = posted.slice(0, 7);
      const rk = `${t.bank_account_id}|${period}`;
      if (!recon.has(rk)) recon.set(rk, { id: `rec-${String(t.bank_account_id).slice(3)}-${period}`, bank_account_id: t.bank_account_id, period });
      add("reconciliation_items", { id: `ri-${id}`, reconciliation_id: recon.get(rk)!.id, bank_transaction_id: id, transfer_id: t.id, status: "Matched", confidence: null, note: "" });
    }
    // Corrupted: a deposit with no matching transfer batch (bank shows it, books don't link it).
    const unmatched: [string, string, number, string][] = [["ba-oe01-trust", "2026-10-21", 284_300, "REMOTE DEPOSIT 10/21"], ["ba-oe06-trust", "2026-10-28", 96_500, "MOBILE DEPOSIT 7731"], ["ba-oe04-trust", "2026-11-02", 151_000, "DEPOSIT 1102 BR 044"]];
    for (const [acct, d, amt, desc] of unmatched) {
      const id = `bt-${++bt}`;
      add("bank_transactions", { id, bank_account_id: acct, posted_on: d, description: desc, amount_cents: amt, transfer_id: null });
      const rk = `${acct}|${d.slice(0, 7)}`;
      if (!recon.has(rk)) recon.set(rk, { id: `rec-${acct.slice(3)}-${d.slice(0, 7)}`, bank_account_id: acct, period: d.slice(0, 7) });
      add("reconciliation_items", { id: `ri-${id}`, reconciliation_id: recon.get(rk)!.id, bank_transaction_id: id, transfer_id: null, status: "Unmatched", confidence: null, note: "" });
      (c.planted["bank_transactions.unmatched_deposit"] ??= []).push(id);
    }
    // Book balance per trust account at each month end (cumulative cleared transfers).
    const monthly = new Map<string, number>();
    for (const t of c.t.transfers) {
      if (t.status !== "Cleared" || !String(t.bank_account_id).endsWith("-trust")) continue;
      const k = `${t.bank_account_id}|${(t.cleared as string).slice(0, 7)}`;
      monthly.set(k, (monthly.get(k) ?? 0) + (t.kind === "Rent" || t.kind === "Other receipt" ? 1 : -1) * (t.amount_cents as number));
    }
    for (const acct of [...new Set(c.t.transfers.map((t) => t.bank_account_id as string))].filter((a) => a.endsWith("-trust")).sort()) {
      let bal = 0;
      for (const t of c.t.transfers) if (t.bank_account_id === acct && t.status === "Cleared" && (t.cleared as string) < `${PERIODS[0]}-01`) bal += (t.kind === "Rent" || t.kind === "Other receipt" ? 1 : -1) * (t.amount_cents as number);
      for (const period of PERIODS.slice(0, -1)) {
        const rk = `${acct}|${period}`;
        const r = recon.get(rk) ?? { id: `rec-${acct.slice(3)}-${period}`, bank_account_id: acct, period };
        bal += monthly.get(rk) ?? 0;
        const open = period === "2026-10";
        add("bank_reconciliations", { ...r, statement_balance_cents: bal + (open && acct === "ba-oe01-trust" ? 284_300 : 0), book_balance_cents: bal, status: open ? (acct === "ba-oe01-trust" || acct === "ba-oe06-trust" ? "Open" : "Balanced") : "Approved", completed_by: open ? null : "grace", completed_at: open ? null : ts(day(`${period}-01`) + 40, 900) });
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  collaboration() {
    const { c } = this;
    // Tasks: lived-in queues per manager (overdue, today, upcoming, done), tied to real records.
    for (const p of c.props) {
      const r = rng(`tasks:${p.id}`);
      const cur = this.currentLeases(p);
      const mk = (title: string, entity: [string, string], assignee: string, dueOff: number, extra: Partial<{ detail: string; priority: string; status: string; queue: string; source: string; role: string }> = {}) =>
        this.task({ title, entity, property: p.id, assignee, due: ASOF + dueOff, created: ASOF + Math.min(dueOff, 0) - r.int(2, 12), by: p.manager, ...extra });
      for (let i = 0; i < Math.max(4, Math.round(p.units.length / 18)); i++) {
        const l = pick(r, cur);
        if (!l) break;
        const kind = r.int(0, 7);
        const dueOff = r.weighted([[-r.int(1, 12), 25], [0, 15], [r.int(1, 14), 35], [-r.int(15, 60), 25]] as const);
        const done = dueOff < -14 || (dueOff < 0 && r.chance(0.3));
        const status = done ? "Done" : dueOff < 3 && r.chance(0.3) ? "In progress" : "Open";
        if (kind === 0) mk(`Call ${name(l.hh)} about renewal`, ["leases", l.id], p.agent, dueOff, { status });
        else if (kind === 1) mk(`Collect proof of renters insurance — ${l.u.number}`, ["leases", l.id], p.agent, dueOff, { status, priority: "Low" });
        else if (kind === 2) mk(`Schedule annual inspection, unit ${l.u.number}`, ["units", l.u.id], p.techs[0] ?? p.manager, dueOff, { status });
        else if (kind === 3) mk(`Review ledger dispute from ${name(l.hh)}`, ["households", l.hh.id], p.manager, dueOff, { status, priority: "High" });
        else if (kind === 4) mk(`Update emergency contact for ${l.u.number}`, ["households", l.hh.id], p.agent, dueOff, { status, priority: "Low" });
        else if (kind === 5) mk(`Order replacement blinds for ${l.u.number}`, ["units", l.u.id], p.techs[0] ?? p.manager, dueOff, { status });
        else if (kind === 6) mk(`Send notice of entry: pest treatment, ${l.u.number}`, ["units", l.u.id], p.manager, dueOff, { status, source: "Automation" });
        else mk(`Verify income docs for ${name(l.hh)}`, ["households", l.hh.id], p.agent, dueOff, { status });
      }
      mk(`Approve ${p.name} November ad spend`, ["properties", p.id], regional(p), 2, { queue: "needs_you" });
      mk(`Walk vacant units at ${p.name}`, ["properties", p.id], p.manager, -1, { priority: "High" });
    }
    for (const t of c.t.turnovers ?? []) if (t.status === "In progress" && rng(`tt:${t.id}`).chance(0.5)) this.task({ title: `Make-ready behind target: unit ${c.unitById[t.unit_id as string].number}`, entity: ["turnovers", t.id as string], property: t.property_id as string, assignee: c.propById[t.property_id as string].supervisor, due: day(t.target_ready_on as string), created: day(t.move_out_on as string), priority: "High", source: "Automation" });
    // Notes with @mentions on the records people work: work orders, households, leases, bills, properties.
    const COMMENTS: [string, string][] = [
      ["work_orders", "Vendor says the part ships Friday. {m} can we give the resident a portable unit until then?"],
      ["work_orders", "Second visit for the same issue in 30 days. {m} flagging for vendor scorecard."],
      ["households", "Resident called — paying the balance on the 15th when payroll hits. Promised in writing. {m} FYI."],
      ["households", "Spoke with the co-signer; they'll cover October. {m} please hold the late fee until Friday."],
      ["leases", "Resident asked about a 15-month renewal to land in spring. {m} OK to quote at the 12-month rate?"],
      ["leases", "Pet addendum signed (one cat). Updated recurring charges."],
      ["bills", "Invoice total doesn't match the PO by $85. {m} can you confirm the extra trip charge?"],
      ["bills", "Coded to R&M per the work order; vendor sent the W-9 update."],
      ["properties", "Budget review moved to Thursday. {m} please bring the October variance notes."],
      ["properties", "Fire marshal walk went well — two extinguishers to re-tag."],
    ];
    for (const p of c.props) {
      const r = rng(`notes:${p.id}`);
      const pools: Record<string, string[]> = {
        work_orders: c.workOrders.filter((w) => w.property_id === p.id && (w.opened_at as string) >= iso(ASOF - 60)).map((w) => w.id as string),
        households: c.households.filter((h) => h.p === p && h.leases.some((l) => CURRENT.has(l.status))).map((h) => h.id),
        leases: this.currentLeases(p).map((l) => l.id),
        bills: c.bills.filter((b) => b.property_id === p.id && (b.bill_date as string) >= iso(ASOF - 60)).map((b) => b.id as string),
        properties: [p.id],
      };
      const pickRecord = (type: string) => (pools[type].length ? pick(r, pools[type]) : undefined);
      const people = [p.manager, p.agent, p.supervisor, regional(p), "grace", p.techs[0] ?? "tom"];
      for (let i = 0; i < Math.round(p.units.length / 5) + 12; i++) {
        const [type, text] = pick(r, COMMENTS);
        const id = pickRecord(type);
        if (!id) continue;
        const author = pick(r, people);
        const target = pick(r, people.filter((x) => x !== author));
        const body = text.replace("{m}", mention(c, target));
        const d = ASOF - r.int(0, 90);
        const nid = this.note(type, id, author, body, d, text.includes("{m}") ? [target] : [], null, r.chance(0.05));
        if (r.chance(0.4)) this.note(type, id, target, pick(r, ["On it.", "Done — updated the record.", "Yes, approved.", "Let's discuss at standup.", "Thanks, saw this."]), Math.min(ASOF, d + r.int(0, 2)), [], nid);
      }
    }
    // Activity timeline per record: leases, households, work orders, bills, units.
    for (const l of c.leases) {
      if (l.start < ASOF - 400) continue;
      const pid = l.u.p.id;
      this.activity("leases", l.id, pid, ts(l.start - 6, 600), "staff", l.u.p.agent, "created", `Lease ${l.id} created for ${l.hh.name}`);
      if (l.row.signed_at) this.activity("leases", l.id, pid, l.row.signed_at as string, "resident", l.hh.residents[0]?.id as string ?? l.hh.id, "signed", "Lease signed electronically by all residents");
      if (l.start <= ASOF && !l.renewalOf) this.activity("leases", l.id, pid, ts(l.start, 660), "staff", l.u.p.agent, "status_changed", `Moved in to unit ${l.u.number}`, { status: "Active" });
      if (l.notice) this.activity("leases", l.id, pid, ts(l.notice, 700), "resident", l.hh.residents[0]?.id as string ?? l.hh.id, "status_changed", "Notice to vacate received", { status: "Notice" });
      if (l.moveOut && l.moveOut <= ASOF) this.activity("leases", l.id, pid, ts(l.moveOut, 900), "staff", l.u.p.manager, "status_changed", `Moved out of unit ${l.u.number}`, { status: "Expired" });
    }
    for (const w of c.workOrders) {
      if ((w.opened_at as string) < iso(ASOF - 120)) continue;
      this.activity("work_orders", w.id as string, w.property_id as string, w.opened_at as string, w.source === "Resident" ? "resident" : "staff", "system", "created", `${w.id} opened: ${w.title}`);
      if (w.completed_at) this.activity("work_orders", w.id as string, w.property_id as string, w.completed_at as string, "staff", c.propById[w.property_id as string].supervisor, "status_changed", `${w.id} completed`, { status: "Completed" });
    }
    for (const b of c.bills) {
      if ((b.bill_date as string) < iso(ASOF - 90)) continue;
      this.activity("bills", b.id as string, b.property_id as string, ts(day(b.bill_date as string), 600), "staff", "s-lucy", "created", `Bill ${b.invoice_number} from ${c.vendorName[b.vendor_id as string]} entered`);
      if (b.approved_at) this.activity("bills", b.id as string, b.property_id as string, b.approved_at as string, "staff", b.approved_by as string, "approved", `Approved by ${c.staffName[b.approved_by as string] ?? b.approved_by}`);
      if (b.status === "Paid") this.activity("bills", b.id as string, b.property_id as string, ts(Math.min(ASOF - 1, day(b.due_on as string)), 780), "system", "money", "paid", "Paid by ACH from the operating trust");
    }
  }

  // -------------------------------------------------------------------------------------------
  dataHealth() {
    const { add, c } = this;
    const issues: R[] = [];
    let n = 0;
    const issue = (rule: string, entity: string, id: string, propertyId: string | null, severity: string, evidence: object, fix: object, d = ASOF - 1, status = "open") => {
      issues.push({ id: `iss-${++n}`, rule_id: rule, entity_type: entity, entity_id: id, property_id: propertyId, detected_at: ts(d, 380), severity, evidence: JSON.stringify(evidence), suggested_fix: JSON.stringify(fix), status, fixed_by: status === "open" ? null : "data_health", fixed_at: status === "open" ? null : ts(d + 1, 400) });
    };
    // Residents: duplicates (same phone, near-identical spelling) and phone numbers in the email field.
    for (const hh of c.households) {
      const r = rng(`dh:${hh.id}`);
      const res = hh.residents[0];
      if (!res || hh.company) continue;
      if (r.chance(0.022)) {
        const nid = `${res.id}-dup`;
        const first = String(res.first_name);
        const alt = first.length > 3 ? first.slice(0, -1) + first.slice(-1).repeat(2) : first + "e";
        add("residents", { ...res, id: nid, first_name: alt, email: `${alt.toLowerCase()}.${String(res.last_name).toLowerCase().replace(/[^a-z]/g, "")}@mail.example`, is_primary: 0 });
        issue("residents.possible_duplicate", "residents", nid, hh.p.id, "warn", { duplicate_of: res.id, name: `${alt} ${res.last_name}`, matches: `${res.first_name} ${res.last_name}`, phone: res.phone }, { action: "residents.merge", params: { keep: res.id, merge: nid }, why: ["Same phone number", `Names differ by one letter ("${alt}" vs "${first}")`, "Same household and property"], confidence: 0.94, source: "rule" });
      } else if (r.chance(0.018)) {
        const before = res.email;
        res.email = String(res.phone).replace(/\D/g, "");
        issue("residents.phone_in_email", "residents", res.id as string, hh.p.id, "warn", { email: res.email, phone: res.phone }, { changes: { email: null, phone: res.phone }, why: ["The email field holds a 10-digit phone number", "It matches the phone on file"], confidence: 0.97, source: "rule", note: `Previous email was ${before}` });
      }
    }
    // Leases: end before start; rent ten times market (typo).
    for (const l of c.leases) {
      const r = rng(`dhl:${l.id}`);
      if (l.commercial || l.status === "Future") continue;
      if (r.chance(0.012) && l.end !== null) {
        const [s, e] = [l.row.start_on, l.row.end_on];
        l.row.start_on = e;
        l.row.end_on = s;
        issue("leases.end_before_start", "leases", l.id, l.u.p.id, "critical", { start_on: e, end_on: s, term_months: l.term }, { changes: { start_on: s, end_on: e }, why: ["End date is before start date", `Swapping them gives a ${l.term}-month term, matching term_months`], confidence: 0.96, source: "rule" });
      } else if (r.chance(0.01) && CURRENT.has(l.status)) {
        l.row.rent_cents = l.rent * 10;
        issue("leases.rent_outlier", "leases", l.id, l.u.p.id, "critical", { rent_cents: l.rent * 10, market_rent_cents: l.u.market, billed_cents: l.rent }, { changes: { rent_cents: l.rent }, why: [`Rent is ${Math.round((l.rent * 10) / l.u.market)}× the unit's market rent`, "Monthly charges bill one tenth of it", "Looks like an extra zero typed at entry"], confidence: 0.92, source: "rule" });
      }
    }
    // Properties: negative unit count, missing ZIP, address not in USPS style.
    const p13 = c.propById.p13.row, p21 = c.propById.p21.row, p05 = c.propById.p05.row;
    p13.unit_count = -20;
    issue("properties.negative_unit_count", "properties", "p13", "p13", "critical", { unit_count: -20, units_rows: 20 }, { changes: { unit_count: 20 }, why: ["Unit count is negative", "20 unit records exist for this property"], confidence: 0.99, source: "rule" });
    const zip = p21.zip;
    p21.zip = "";
    issue("properties.missing_zip_state", "properties", "p21", "p21", "warn", { zip: "", city: p21.city, state: p21.state }, { changes: { zip }, why: ["ZIP is missing", `Street and city match ZIP ${zip} (Kirkwood, Atlanta)`], confidence: 0.9, source: "rule" });
    const street = p05.street;
    p05.street = String(street).toUpperCase().replace(" AVE", " AVENUE") + ".";
    issue("properties.address_format", "properties", "p05", "p05", "info", { street: p05.street }, { changes: { street }, why: ["Street is in capitals with a trailing period", "USPS style abbreviates the suffix (Ave)"], confidence: 0.88, source: "rule" });
    // Units: orphaned property link; impossible square footage.
    for (const [i, u] of c.units.filter((u) => u.status === "Vacant" && !u.commercial && u.p.id !== "p01").entries()) {
      if (i % 9 === 4 && i < 60) {
        const right = u.p.id;
        u.row.property_id = right.toUpperCase();
        issue("units.orphan_property", "units", u.id, right, "critical", { property_id: right.toUpperCase(), unit_number: u.number }, { changes: { property_id: right }, why: [`No property has id ${right.toUpperCase()}`, `Unit id and number match ${u.p.name} (${right})`], confidence: 0.95, source: "rule" });
      } else if (i % 13 === 6 && i < 120) {
        u.row.sqft = u.sqft * 10;
        issue("units.sqft_outlier", "units", u.id, u.p.id, "warn", { sqft: u.sqft * 10, unit_type_sqft: u.sqft }, { changes: { sqft: u.sqft }, why: ["10× the floor plan's square footage"], confidence: 0.9, source: "rule" });
      }
    }
    // Payments posted to a neighbouring lease (same property, so totals still tie).
    const pays = c.t.payments;
    for (let i = 4000; i < pays.length; i += 9000) {
      const pmt = pays[i];
      const lease = c.leaseById[pmt.lease_id as string];
      const other = c.leases.find((l) => l.u.p === lease.u.p && l !== lease && CURRENT.has(l.status) && l.u.floor === lease.u.floor);
      if (!other) continue;
      pmt.lease_id = other.id;
      issue("payments.wrong_lease", "payments", pmt.id as string, lease.u.p.id, "warn", { posted_to: other.id, charge_id: pmt.charge_id, charge_lease: lease.id, amount_cents: pmt.amount_cents }, { changes: { lease_id: lease.id }, why: ["The charge it pays belongs to another lease", `Amount matches ${lease.id}'s charge exactly`], confidence: 0.91, source: "rule" });
    }
    // Ledger-side plants from generate.ts.
    for (const id of c.planted["bill_lines.gl_miscoded"] ?? []) {
      const line = c.t.bill_lines.find((l) => l.bill_id === id)!;
      const bill = c.bills.find((b) => b.id === id)!;
      issue("bill_lines.gl_miscoded", "bill_lines", line.id as string, bill.property_id as string, "warn", { gl_account: "6100 Landscaping", description: line.description, vendor: c.vendorName[bill.vendor_id as string] }, { changes: { gl_account_id: "gl-6000" }, why: ["Plumbing repair on a work order", "Vendor's trade is plumbing; landscaping doesn't fit"], confidence: 0.89, source: "ap" });
    }
    for (const id of c.planted["owner_distributions.rounding_cent"] ?? []) issue("owner_distributions.rounding_cent", "owner_distributions", id, null, "info", { difference_cents: 1 }, { action: "owner_distributions.adjust", params: { amount_cents: 1 }, why: ["Statement net is $0.01 more than the distribution plus reserve"], confidence: 0.99, source: "owner_reporting" });
    for (const id of c.planted["bank_transactions.unmatched_deposit"] ?? []) {
      const t = c.t.bank_transactions.find((b) => b.id === id)!;
      const near = c.t.transfers.filter((x) => x.bank_account_id === t.bank_account_id && x.kind === "Rent" && x.status === "Cleared").sort((a, b) => Math.abs((a.amount_cents as number) - (t.amount_cents as number)) - Math.abs((b.amount_cents as number) - (t.amount_cents as number)))[0];
      issue("bank_transactions.unmatched_deposit", "bank_transactions", id, near?.property_id as string ?? null, "warn", { amount_cents: t.amount_cents, posted_on: t.posted_on }, { action: "bank_transactions.match", params: { transfer_id: near?.id }, why: ["No transfer batch links to this deposit", `Closest batch: ${near?.ref} for ${((near?.amount_cents as number) / 100).toFixed(2)}`], confidence: 0.62, source: "reconciliation" });
    }
    for (const rule of ["prospects.invalid_email", "documents.import_swapped_columns", "documents.misfiled"]) {
      for (const id of c.planted[rule] ?? []) {
        const table = rule.split(".")[0];
        const row = c.t[table].find((x) => x.id === id)!;
        const fix = rule === "prospects.invalid_email" ? { changes: { email: String(row.email).replace("gmial,com", "gmail.com") }, why: ['"gmial,com" is a typo for gmail.com'], confidence: 0.86, source: "rule" } : rule === "documents.misfiled" ? { changes: { entity_type: "leases" }, why: ["Classified as a lease but filed to a vendor", "Unit 318 has an active lease at Old Fourth Ward Lofts"], confidence: 0.81, source: "document_classifier" } : { action: "documents.reimport", params: { swap: [["first_name", "last_name"], ["rent", "deposit"]] }, why: ["Every row has rent below deposit by ~2.5×", "First names appear in the last-name column"], confidence: 0.93, source: "data_health" };
        issue(rule, table, id, (row.property_id as string) ?? null, rule === "documents.misfiled" ? "info" : "warn", { name: row.name ?? row.email }, fix);
      }
    }
    // Vendor bank details changed without a verification task (fraud flag): hold payments.
    const v26 = c.t.vendors.find((v) => v.id === "v26")!;
    v26.bank_last4 = "0917";
    v26.bank_changed_at = ts(ASOF - 3, 1310);
    issue("vendors.unverified_bank_change", "vendors", "v26", null, "critical", { bank_last4: "0917", previous_last4: "5521", changed_at: v26.bank_changed_at, requested_by: "email from keyright-locksmiths.co (lookalike domain)" }, { action: "vendors.hold_payments", params: { create_task: true }, why: ["Bank details changed 3 days ago", "No verification task or callback on file", "Request came from a lookalike email domain"], confidence: 0.95, source: "ap" });
    // Completed vendor jobs with no cost recorded.
    for (const w of c.workOrders.filter((w) => w.status === "Completed" && w.vendor_id && (w.completed_at as string) >= iso(ASOF - 60)).filter((_, i) => i % 40 === 3)) {
      w.cost_cents = null;
      issue("work_orders.completed_without_cost", "work_orders", w.id as string, w.property_id as string, "info", { status: "Completed", cost_cents: null }, { changes: { cost_cents: w.estimate_cents }, why: ["Vendor job completed with no cost", "Use the approved estimate until the invoice arrives"], confidence: 0.7, source: "rule" });
    }
    // A few already fixed (history in data_fix_log + audit).
    for (const iss of issues.filter((_, i) => i % 11 === 5)) {
      iss.status = "fixed";
      iss.fixed_by = "marcus";
      iss.fixed_at = ts(ASOF - 2, 1000);
    }
    for (const i of issues) add("data_issues", i);
    for (const i of issues.filter((i) => i.status === "fixed")) {
      const fix = JSON.parse(i.suggested_fix as string);
      add("audit", { id: `au-fix-${i.id}`, at: i.fixed_at, actor: "Marcus Bell", actor_id: "marcus", role: "property_manager", agent: "data_health", model: "rules", action: "Data fix applied", entity_type: i.entity_type, entity_id: i.entity_id, property_id: i.property_id, detail: `${i.rule_id}: ${fix.why?.[0] ?? ""}`, before_json: i.evidence, after_json: JSON.stringify(fix.changes ?? fix.params ?? {}) });
      add("data_fix_log", { id: `dfl-${i.id}`, issue_id: i.id, audit_id: `au-fix-${i.id}`, entity_type: i.entity_type, entity_id: i.entity_id, before_json: i.evidence, after_json: JSON.stringify(fix.changes ?? fix.params ?? {}), fixed_by: "marcus", agent: "data_health", at: i.fixed_at });
    }
    // The rules. check_sql uses {{table}} for the effective (base + overlay) view of that table.
    const RULES: [string, string, string, string, string, string | null][] = [
      ["residents.possible_duplicate", "residents", "Possible duplicate resident", "warn", "Two residents at the same property share a phone number and nearly the same name.", "SELECT a.id FROM {{residents}} a JOIN {{residents}} b ON a.phone = b.phone AND a.property_id = b.property_id AND a.id > b.id AND a.last_name = b.last_name"],
      ["residents.phone_in_email", "residents", "Phone number in email field", "warn", "The email field holds digits only.", "SELECT id FROM {{residents}} WHERE email NOT LIKE '%@%'"],
      ["leases.end_before_start", "leases", "Lease ends before it starts", "critical", "end_on is earlier than start_on.", "SELECT id FROM {{leases}} WHERE end_on < start_on"],
      ["leases.rent_outlier", "leases", "Rent far above market", "critical", "Lease rent is more than 3× the unit's market rent.", "SELECT l.id FROM {{leases}} l JOIN {{units}} u ON u.id = l.unit_id WHERE l.rent_cents > 3 * u.market_rent_cents AND l.kind = 'Residential'"],
      ["properties.negative_unit_count", "properties", "Negative unit count", "critical", "unit_count is below zero.", "SELECT id FROM {{properties}} WHERE unit_count < 0"],
      ["properties.missing_zip_state", "properties", "Missing ZIP or state", "warn", "ZIP or state is blank.", "SELECT id FROM {{properties}} WHERE zip = '' OR state = ''"],
      ["properties.address_format", "properties", "Address not in USPS format", "info", "Street is all capitals or ends with a period.", "SELECT id FROM {{properties}} WHERE street = upper(street) OR street LIKE '%.'"],
      ["units.orphan_property", "units", "Unit points to a missing property", "critical", "property_id doesn't match any property.", "SELECT u.id FROM {{units}} u WHERE NOT EXISTS (SELECT 1 FROM {{properties}} p WHERE p.id = u.property_id)"],
      ["units.sqft_outlier", "units", "Square footage outlier", "warn", "Unit sq ft is more than 3× its floor plan.", "SELECT u.id FROM {{units}} u JOIN {{unit_types}} t ON t.id = u.unit_type_id WHERE u.sqft > 3 * t.sqft"],
      ["payments.wrong_lease", "payments", "Payment posted to the wrong lease", "warn", "The payment's lease differs from the lease of the charge it pays.", "SELECT p.id FROM {{payments}} p JOIN {{charges}} c ON c.id = p.charge_id WHERE p.lease_id <> c.lease_id"],
      ["bill_lines.gl_miscoded", "bills", "GL account doesn't fit the line", "warn", "A repair line on a work-order bill is coded to Landscaping.", "SELECT l.id FROM {{bill_lines}} l JOIN {{bills}} b ON b.id = l.bill_id WHERE b.work_order_id IS NOT NULL AND l.gl_account_id = 'gl-6100'"],
      ["bank_transactions.unmatched_deposit", "bank_transactions", "Unmatched bank deposit", "warn", "A deposit on the bank feed has no matching transfer batch.", "SELECT id FROM {{bank_transactions}} WHERE transfer_id IS NULL AND amount_cents > 0"],
      ["owner_distributions.rounding_cent", "owner_distributions", "Statement off by a cent", "info", "Net income differs from distribution plus reserve by one cent.", "SELECT id FROM {{owner_distributions}} WHERE abs(income_cents - expense_cents - fee_cents - amount_cents - reserve_cents) = 1"],
      ["vendors.unverified_bank_change", "vendors", "Unverified vendor bank change", "critical", "Bank details changed in the last 30 days with no verification task.", "SELECT v.id FROM {{vendors}} v WHERE v.bank_changed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM {{tasks}} t WHERE t.entity_type = 'vendors' AND t.entity_id = v.id AND t.title LIKE 'Verify bank%' AND t.status = 'Done')"],
      ["documents.import_swapped_columns", "documents", "Import columns look swapped", "warn", "An import's rent is lower than its deposit on every row, or names are reversed.", null],
      ["documents.misfiled", "documents", "Document filed to the wrong record", "info", "The document type doesn't fit the record it's filed to.", "SELECT id FROM {{documents}} WHERE doc_type = 'Lease' AND entity_type <> 'leases'"],
      ["prospects.invalid_email", "prospects", "Invalid prospect email", "info", "Email has a typo in the domain.", "SELECT id FROM {{prospects}} WHERE email NOT LIKE '%@%.%' OR email LIKE '%,%'"],
      ["work_orders.completed_without_cost", "work_orders", "Completed vendor job without cost", "info", "A vendor work order is completed with no cost recorded.", "SELECT id FROM {{work_orders}} WHERE status = 'Completed' AND vendor_id IS NOT NULL AND cost_cents IS NULL"],
    ];
    for (const [id, entity, nm, severity, description, sql] of RULES) add("data_rules", { id, entity_type: entity, name: nm, severity, description, check_kind: sql ? "sql" : "computed", check_sql: sql, help_slug: "data-health-fix-issues", enabled: 1 });
  }

  // -------------------------------------------------------------------------------------------
  ai() {
    const { add, c } = this;
    const AGENTS: [string, string, string, string, string[], object, string, string | null][] = [
      ["collections", "Collections agent", "property_manager", "Follow up on past-due balances, offer payment plans within policy, and draft notices.", ["charges.list_overdue", "households.get", "messages.draft", "payment_plans.propose"], { schedule: "0 14 * * *", events: ["payment.failed", "charge.overdue"] }, "act_with_approval", "pol-org-write-off"],
      ["leasing", "Leasing agent", "leasing_agent", "Answer leads, book tours, summarize screening, and score applicants with plain-English reasons.", ["prospects.list", "showings.schedule", "applications.score", "messages.draft"], { schedule: "*/30 13-23 * * *", events: ["prospect.created", "application.submitted"] }, "act_with_approval", null],
      ["renewals", "Renewals agent", "property_manager", "Price renewal offers 90–120 days out from comps and the resident's history.", ["leases.list_expiring", "units.market_rent", "renewal_offers.propose"], { schedule: "0 15 * * 1", events: ["lease.expiring"] }, "suggest", null],
      ["maintenance_triage", "Maintenance Triage agent", "maintenance_supervisor", "Classify trade and urgency, rank vendors, and check the owner approval limit.", ["work_orders.get", "vendors.rank", "approval_policies.check", "work_orders.propose_assignment"], { events: ["wo.created", "service_request.created"] }, "auto_within_policy", "pol-org-maintenance-spend"],
      ["ap", "Payables agent", "accountant", "Read invoices, code them to GL, and flag anomalies, duplicates and bank changes.", ["documents.extract", "bills.code", "bills.anomaly_check", "vendors.get"], { events: ["invoice.received"], schedule: "0 12 * * *" }, "act_with_approval", "pol-org-bill-payment"],
      ["data_health", "Data Health agent", "admin", "Run data rules, explain issues, and propose fixes with before/after.", ["data_rules.run", "data_issues.list", "data_issues.propose_fix"], { schedule: "0 */6 * * *", events: ["import.completed"] }, "auto_within_policy", null],
      ["owner_reporting", "Owner Reporting agent", "accountant", "Explain owner statements and variances from computed facts.", ["owner_statements.get", "metrics.variance", "messages.draft"], { schedule: "0 13 2 * *", events: ["owner.distribution_sent"] }, "suggest", null],
      ["compliance", "Compliance agent", "maintenance_supervisor", "Track COIs, inspections, permits and certificates; request renewals before they lapse.", ["vendor_cois.list_expiring", "compliance_items.list", "messages.draft"], { schedule: "0 11 * * *", events: ["coi.expiring"] }, "auto_within_policy", "pol-org-safety"],
    ];
    for (const [id, nm, role, goal, tools, triggers, autonomy, pol] of AGENTS) add("agent_definitions", { id, name: nm, owner_role: role, goal, tools: JSON.stringify(tools), triggers: JSON.stringify(triggers), autonomy, approval_policy_id: pol, enabled: 1, model: id === "ap" || id === "owner_reporting" ? "claude-sonnet-4-5" : null });

    // Run history over the last 30 days with step traces; proposals link to their run and step.
    let run = 0, prop = 0, ev = 0;
    const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "claude-sonnet-4-5", "rules"];
    const proposals: R[] = [];
    const doRun = (agent: string, d: number, minute: number, trigger: string, tools: string[], props: { entity: string; id: string; pid: string | null; action: string; title: string; why: string[]; conf: number; amount?: number; risk?: string; queue: string; role: string; payload?: object; evidence?: object[] }[], summary: string, eventType?: string) => {
      const r = rng(`run:${agent}:${d}:${minute}`);
      const id = `run-${String(++run).padStart(5, "0")}`;
      const model = agent === "ap" || agent === "owner_reporting" ? MODELS[1] : r.chance(0.85) ? MODELS[0] : MODELS[2];
      let eventId: string | null = null;
      if (trigger === "event") {
        eventId = `ev-h-${++ev}`;
        add("events", { id: eventId, type: eventType ?? "wo.created", entity_type: props[0]?.entity ?? null, entity_id: props[0]?.id ?? null, property_id: props[0]?.pid ?? null, payload: JSON.stringify({}), created_at: ts(d, minute - 1), processed_at: ts(d, minute), run_id: id });
      }
      let at = minute;
      let idx = 0;
      const step = (kind: string, tool: string | null, input: object | null, output: object | null, ms: number) => {
        const sid = `${id}-s${idx}`;
        add("agent_steps", { id: sid, run_id: id, idx: idx++, kind, tool_key: tool, input: input ? JSON.stringify(input) : null, output: output ? JSON.stringify(output) : null, latency_ms: ms, ok: 1, at: ts(d, Math.min(1439, at)) });
        return sid;
      };
      step("plan", null, null, { plan: `Check ${tools.map((t) => t.split(".")[0]).join(", ")}; propose actions that need a person.` }, r.int(300, 1400));
      for (const tool of tools) {
        step("tool_call", tool, { scope: props[0]?.pid ?? "portfolio", as_of: AS_OF }, null, 0);
        step("tool_result", tool, null, { rows: r.int(1, 40), truncated: false }, r.int(20, 380));
      }
      step("reasoning_summary", null, null, { summary }, r.int(200, 900));
      for (const p of props) {
        const sid = step("proposal", null, { action: p.action, entity: p.entity, id: p.id }, { title: p.title, confidence: p.conf }, r.int(5, 40));
        proposals.push({ id: `prop-${String(++prop).padStart(5, "0")}`, agent, entity_type: p.entity, entity_id: p.id, property_id: p.pid, action: p.action, title: p.title, payload: JSON.stringify(p.payload ?? {}), why: JSON.stringify(p.why), evidence: JSON.stringify(p.evidence ?? [{ entity_type: p.entity, entity_id: p.id, label: p.title }]), confidence: p.conf, risk: p.risk ?? "Low", amount_cents: p.amount ?? null, queue_state: p.queue, assignee_role: p.role, model, run_id: id, step_id: sid, created_at: ts(d, Math.min(1439, at + 1)) });
      }
      at += 2;
      const tin = r.int(1800, 9000), tout = r.int(200, 1400);
      add("agent_runs", { id, agent_key: agent, trigger_kind: trigger, event_id: eventId, started_by: trigger === "manual" ? "marcus" : null, status: props.some((p) => p.queue === "needs_you") && d >= ASOF - 3 ? "waiting_approval" : "done", started_at: ts(d, minute), ended_at: ts(d, Math.min(1439, at)), model, tokens_in: model === "rules" ? 0 : tin, tokens_out: model === "rules" ? 0 : tout, cost_cents: model === MODELS[1] ? Math.round((tin * 3 + tout * 15) / 10000) : 0, summary, error: null });
    };
    // Collections: one sweep a day per region; proposals for households 30+ days late.
    const late = c.households.filter((h) => h.open.some((o) => o.rem > 0 && ASOF - o.due > 20) && h.leases.some((l) => CURRENT.has(l.status)));
    for (let d = ASOF - 29; d <= ASOF; d++) {
      for (const region of ["r-tx", "r-se", "r-sw"]) {
        const r = rng(`col:${d}:${region}`);
        const hhs = late.filter((h) => h.p.region === region && r.chance(d >= ASOF - 1 ? 0.5 : 0.08));
        const recent = d >= ASOF - 1;
        doRun("collections", d, 14 * 60 + (region === "r-tx" ? 0 : region === "r-se" ? 5 : 10), "schedule", ["charges.list_overdue", "households.get", "messages.draft"], hhs.slice(0, recent ? 6 : 3).map((h) => {
          const owed = h.open.reduce((s, o) => s + Math.max(0, o.rem), 0);
          const plan = owed > 300_000;
          return { entity: "households", id: h.id, pid: h.p.id, action: plan ? "households.offer_payment_plan" : "households.send_reminder", title: plan ? `Offer a 3-month payment plan to ${name(h)} ($${Math.round(owed / 100).toLocaleString("en-US")} owed)` : `Send a past-due reminder to ${name(h)}`, why: [`$${Math.round(owed / 100).toLocaleString("en-US")} past due`, `${h.open.filter((o) => o.rem > 0).length} unpaid charges`, plan ? "Balance is over 1.5× monthly rent; plans recover 71% vs 38% for filings" : "First reminder this month"], conf: plan ? 0.78 : 0.92, amount: owed, risk: plan ? "Medium" : "Low", queue: recent ? (plan ? "needs_you" : "auto_handled") : r.chance(0.7) ? "auto_handled" : "needs_you", role: "property_manager", payload: { channel: h.residents[0]?.preferred_channel ?? "Email", template_id: h.residents[0]?.language === "es" ? "tpl-late-notice-es" : "tpl-late-notice" } };
        }), `Checked ${hhs.length + r.int(20, 60)} balances in ${region === "r-tx" ? "Texas" : region === "r-se" ? "the Southeast" : "the Southwest"}; ${hhs.length} need follow-up.`);
      }
    }
    // Maintenance triage on each recent resident work order (event-driven).
    for (const w of c.workOrders.filter((w) => (w.opened_at as string) >= iso(ASOF - 14) && w.source === "Resident")) {
      const d = day(w.opened_at as string);
      const m = Number((w.opened_at as string).slice(11, 13)) * 60 + Number((w.opened_at as string).slice(14, 16)) + 2;
      const p = c.propById[w.property_id as string];
      const est = (w.estimate_cents as number) ?? 0;
      const overOwner = est > 250_000;
      doRun("maintenance_triage", d, Math.min(1430, m), "event", ["work_orders.get", "vendors.rank", "approval_policies.check"], [{ entity: "work_orders", id: w.id as string, pid: p.id, action: "work_orders.assign_vendor", title: `Assign ${w.vendor_id ? c.vendorName[w.vendor_id as string] : "in-house tech"} to ${w.id} (${w.category}, ${String(w.priority).toLowerCase()})`, why: [`Classified as ${w.category} from the request text`, w.vendor_id ? `${c.vendorName[w.vendor_id as string]}: best rating and on-time rate for ${w.category} in ${p.metro}` : "Simple repair; in-house tech available today", overOwner ? "Estimate is over the owner approval limit" : `Estimate $${Math.round(est / 100)} is within the $750 auto-approve limit`], conf: 0.86, amount: est, risk: overOwner ? "High" : "Low", queue: (w.status === "New" || w.status === "Triaged") && d >= ASOF - 1 ? "needs_you" : "auto_handled", role: "maintenance_supervisor" }], `Triage: ${w.category}, ${w.priority}. ${w.vendor_id ? "Vendor ranked." : "In-house."}`, "wo.created");
    }
    // Payables: anomaly checks on recent bills.
    const recentBills = c.bills.filter((b) => (b.bill_date as string) >= iso(ASOF - 10) && b.status !== "Paid");
    for (const b of recentBills.filter((_, i) => i % 3 === 0).slice(0, 90)) {
      const r = rng(`ap:${b.id}`);
      const anomaly = r.chance(0.18) || b.vendor_id === "v26";
      doRun("ap", day(b.bill_date as string) + 1, 12 * 60 + r.int(0, 50), "event", ["documents.extract", "bills.code", "bills.anomaly_check"], [{ entity: "bills", id: b.id as string, pid: b.property_id as string, action: anomaly ? "bills.hold" : "bills.approve", title: anomaly ? (b.vendor_id === "v26" ? `Hold ${b.id}: vendor bank details changed 3 days ago` : `Review ${b.id}: ${c.vendorName[b.vendor_id as string]} invoice is 2.4× their median`) : `Approve ${b.id} from ${c.vendorName[b.vendor_id as string]} ($${((b.amount_cents as number) / 100).toFixed(2)})`, why: anomaly ? (b.vendor_id === "v26" ? ["Bank account changed on " + iso(ASOF - 3), "No callback verification on file", "Lookalike sender domain"] : ["Amount is 2.4× the vendor's 12-month median", "No matching purchase order", "Same description as last month's invoice"]) : ["Matches the work order and PO", "Coded to Repairs and maintenance (6000)", "Vendor W-9 and COI on file"], conf: anomaly ? 0.83 : 0.95, amount: b.amount_cents as number, risk: anomaly ? "High" : "Low", queue: b.status === "Pending approval" || anomaly ? "needs_you" : "auto_handled", role: "accountant" }], anomaly ? "Flagged an anomaly for review." : "Read, coded and matched the invoice.", "invoice.received");
    }
    // Renewals: weekly pricing runs for leases ending in the next 120 days.
    for (const d of [ASOF - 28, ASOF - 21, ASOF - 14, ASOF - 7, ASOF - 1]) {
      const exp = c.leases.filter((l) => ["Active", "Month-to-month"].includes(l.status) && l.end !== null && l.end - d < 120 && l.end - d > 60 && !l.commercial && rng(`ren:${l.id}:${d}`).chance(0.12));
      doRun("renewals", d, 15 * 60, "schedule", ["leases.list_expiring", "units.market_rent", "renewal_offers.propose"], exp.slice(0, 8).map((l) => ({ entity: "leases", id: l.id, pid: l.u.p.id, action: "renewal_offers.send", title: `Renew ${l.hh.name} at $${Math.round(round(l.rent * 1.03, 500) / 100).toLocaleString("en-US")} (+3%) for 12 months`, why: [`Market rent for ${l.u.number} is $${Math.round(l.u.market / 100)}`, "On-time payment history", "Similar renewals accepted at +2.5–3.5% this quarter"], conf: 0.74, amount: round(l.rent * 1.03, 500), risk: "Low", queue: d >= ASOF - 7 ? "needs_you" : "auto_handled", role: "property_manager", payload: { term_months: 12, rent_cents: round(l.rent * 1.03, 500) } })), `Priced ${exp.length} renewals.`);
    }
    // Data Health: every 6 hours; proposals for open critical issues.
    const crit = (this.t.data_issues ?? []).filter((i) => i.status === "open");
    for (let d = ASOF - 6; d <= ASOF; d++) for (const h of [2, 8, 14, 20]) {
      if (d === ASOF && h > 8) continue;
      const fresh = d === ASOF - 1 && h === 2;
      doRun("data_health", d, h * 60, "schedule", ["data_rules.run", "data_issues.list"], fresh ? crit.slice(0, 40).map((i) => ({ entity: i.entity_type as string, id: i.entity_id as string, pid: i.property_id as string | null, action: "data_issues.apply_fix", title: `Fix: ${String(i.rule_id).split(".")[1].replace(/_/g, " ")} (${i.entity_id})`, why: JSON.parse(i.suggested_fix as string).why, conf: JSON.parse(i.suggested_fix as string).confidence, risk: i.rule_id === "vendors.unverified_bank_change" || String(i.rule_id).startsWith("payments") || String(i.rule_id).startsWith("owner_distributions") ? "High" : "Low", queue: i.severity === "info" ? "auto_handled" : "needs_you", role: "admin", payload: { issue_id: i.id } })) : [], fresh ? `Ran 18 rules; ${crit.length} open issues, ${crit.filter((i) => i.severity === "critical").length} critical.` : "Ran 18 rules; no new issues.");
    }
    // Compliance and owner reporting.
    doRun("compliance", ASOF, 11 * 60, "schedule", ["vendor_cois.list_expiring", "compliance_items.list"], (this.t.vendor_cois ?? []).filter((x) => x.status !== "Valid").map((x) => ({ entity: "vendors", id: x.vendor_id as string, pid: null, action: "vendors.request_coi", title: `Request a current COI from ${c.vendorName[x.vendor_id as string]} (${x.status === "Expired" ? "expired" : "expires"} ${x.expires_on})`, why: [`Certificate ${x.status === "Expired" ? "expired" : "expires"} on ${x.expires_on}`, "Vendor has open or scheduled jobs"], conf: 0.97, risk: x.status === "Expired" ? "Medium" : "Low", queue: x.status === "Expired" ? "needs_you" : "auto_handled", role: "maintenance_supervisor" })), "Checked 34 certificates and 120 compliance items.");
    doRun("owner_reporting", ASOF - 2, 13 * 60, "schedule", ["owner_statements.get", "metrics.variance"], [{ entity: "owner_entities", id: "oe01", pid: null, action: "messages.send", title: "Send Helen Carter the October variance explanation", why: ["Distribution down 9% vs September", "Roof progress payment $48,500 at Barton Creek", "Higher HVAC spend after August heat"], conf: 0.82, risk: "Low", queue: "needs_you", role: "accountant" }], "Drafted October statement notes for 8 owner entities.");
    doRun("leasing", ASOF, 9 * 60, "schedule", ["prospects.list", "messages.draft"], (this.t.prospects ?? []).filter((p) => p.stage === "Contacted" && p.last_contact_at && (p.last_contact_at as string) < iso(ASOF - 3)).slice(0, 12).map((p) => ({ entity: "prospects", id: p.id as string, pid: p.property_id as string, action: "prospects.send_follow_up", title: `Follow up with ${p.name}: no contact in ${Math.max(3, ASOF - day(p.last_contact_at as string))} days`, why: ["Interested lead gone quiet", `Desired move-in ${p.desired_move_in}`], conf: 0.88, risk: "Low", queue: "needs_you", role: "leasing_agent" })), "Found prospects waiting on a reply.");
    for (const app of (this.t.applications ?? []).filter((a) => a.stage === "Review")) doRun("leasing", ASOF - 1, 16 * 60 + rng(String(app.id)).int(0, 300), "event", ["applications.score"], [{ entity: "applications", id: app.id as string, pid: app.property_id as string, action: app.recommendation === "Deny" ? "applications.deny" : "applications.approve", title: `${app.recommendation} application ${app.id} (score ${app.score})`, why: JSON.parse(app.scoring_factors as string).map((f: { detail: string; direction: string }) => `${f.direction === "+" ? "For" : "Against"}: ${f.detail}`), conf: 0.8, risk: "Medium", queue: "needs_you", role: "broker" }], "Scored the application from income, credit band and rental history.", "application.submitted");

    // Decisions on older proposals (history), and their audit rows.
    for (const p of proposals) {
      const created = day(p.created_at as string);
      if (p.queue_state === "auto_handled") {
        add("audit", { id: `au-${p.id}`, at: p.created_at, actor: AGENTS.find((a) => a[0] === p.agent)![1], actor_id: p.agent, role: null, agent: p.agent, model: p.model, action: "Applied within policy", entity_type: p.entity_type, entity_id: p.entity_id, property_id: p.property_id, detail: p.title, before_json: null, after_json: p.payload });
      } else if (created < ASOF - 2 && p.queue_state === "needs_you") {
        const r = rng(`dec:${p.id}`);
        const decision = r.weighted([["Approved", 70], ["Rejected", 15], ["Edited", 15]] as const);
        const by = p.assignee_role === "accountant" ? "grace" : p.assignee_role === "broker" ? "rachel" : p.assignee_role === "maintenance_supervisor" ? "tom" : p.assignee_role === "admin" ? "sam" : c.propById[p.property_id as string]?.manager ?? "marcus";
        add("ai_decisions", { id: `dec-${p.id}`, proposal_id: p.id, decision, decided_by: by, note: decision === "Rejected" ? pick(r, ["Resident already called us.", "Hold until the hearing.", "Vendor confirmed this is correct."]) : "", edited_payload: decision === "Edited" ? p.payload : null, decided_at: ts(created + r.int(0, 2), 900) });
        add("audit", { id: `au-${p.id}`, at: ts(created + 1, 905), actor: c.staffName[by], actor_id: by, role: p.assignee_role, agent: p.agent, model: p.model, action: `AI proposal ${decision.toLowerCase()}`, entity_type: p.entity_type, entity_id: p.entity_id, property_id: p.property_id, detail: p.title, before_json: null, after_json: decision === "Rejected" ? null : p.payload });
        p.queue_state = "auto_handled";
      }
      add("ai_proposals", p);
    }
    // Pending events not yet picked up (the outbox right now).
    for (const w of c.workOrders.filter((w) => w.status === "New")) add("events", { id: `ev-new-${w.id}`, type: "wo.created", entity_type: "work_orders", entity_id: w.id, property_id: w.property_id, payload: JSON.stringify({ priority: w.priority }), created_at: w.opened_at, processed_at: null, run_id: null });
    for (const x of (this.t.vendor_cois ?? []).filter((x) => x.status === "Expiring")) add("events", { id: `ev-coi-${x.id}`, type: "coi.expiring", entity_type: "vendors", entity_id: x.vendor_id, property_id: null, payload: JSON.stringify({ expires_on: x.expires_on }), created_at: ts(ASOF, 360), processed_at: null, run_id: null });

    // AI summaries: rule-based placeholders the AI lane replaces with model output (same ids).
    const sum = (entity: string, id: string, summary: string, facts: object) => add("ai_summaries", { id: `sum-${entity}-${id}`, entity_type: entity, entity_id: id, summary, facts: JSON.stringify(facts), model: "rules", generated_at: ts(ASOF, 300) });
    const oct = new Map((c.t.metrics_monthly ?? []).filter((m) => m.month === "2026-10").map((m) => [m.property_id as string, m]));
    for (const p of c.props) {
      const m = oct.get(p.id)!;
      const occ = Math.round((m.occupancy_phys as number) * 1000) / 10;
      const noi = Math.round((m.noi_cents as number) / 100);
      const bud = Math.round(((m.budget_noi_cents as number) ?? 0) / 100);
      const late = Math.round(((m.aging_31_60_cents as number) + (m.aging_61_90_cents as number) + (m.aging_90p_cents as number)) / 100);
      sum("properties", p.id, `${p.name} is ${occ}% occupied. October NOI was $${noi.toLocaleString("en-US")}, ${noi >= bud ? "ahead of" : "behind"} budget by $${Math.abs(noi - bud).toLocaleString("en-US")}. $${late.toLocaleString("en-US")} is more than 30 days past due; ${m.wo_open} work orders are open.`, { occupancy_pct: occ, noi_oct: noi, budget_noi_oct: bud, past_due_30: late, open_work_orders: m.wo_open });
    }
    for (const h of late.slice(0, 120)) {
      const owed = h.open.reduce((s, o) => s + Math.max(0, o.rem), 0);
      sum("households", h.id, `${h.name} owes $${Math.round(owed / 100).toLocaleString("en-US")} across ${h.open.filter((o) => o.rem > 0).length} charges. ${h.plan ? "A payment plan is in place." : h.evict ? "An eviction hearing is scheduled." : "No payment plan yet."}`, { owed_cents: owed, plan: !!h.plan, eviction: !!h.evict });
    }
    for (const [id, company] of VENDORS.slice(0, 28)) {
      const jobs = c.workOrders.filter((w) => w.vendor_id === id);
      sum("vendors", id, `${company} has done ${jobs.length} jobs in 18 months; ${jobs.filter((w) => !w.completed_at && w.status !== "Cancelled").length} are open.`, { jobs: jobs.length });
    }
    // Feedback and an assistant history for the default persona.
    proposals.slice(0, 30).forEach((p, i) => i % 3 === 0 && add("ai_feedback", { id: `fb-${p.id}`, target_kind: "proposal", target_id: p.id, rating: i % 9 === 0 ? -1 : 1, comment: i % 9 === 0 ? "Resident had already paid by check." : "", by_id: "marcus", at: p.created_at }));
    add("assistant_threads", { id: "at-1", user_id: "marcus", title: "Who is late on rent at Barton Creek?", context_type: "properties", context_id: "p02", created_at: ts(ASOF - 1, 560), updated_at: ts(ASOF - 1, 562) });
    add("assistant_messages", { id: "at-1-m1", thread_id: "at-1", role: "user", content: "Who is late on rent at Barton Creek?", plan: null, citations: "[]", model: null, at: ts(ASOF - 1, 560) });
    const p02late = late.filter((h) => h.p.id === "p02").slice(0, 5);
    add("assistant_messages", { id: "at-1-m2", thread_id: "at-1", role: "assistant", content: `${p02late.length} households at Barton Creek Commons are more than 20 days late: ${p02late.map((h) => h.name).join(", ")}.`, plan: JSON.stringify({ entity: "charges", filters: { property_id: "p02", status: "Overdue" }, agg: "count_by_household" }), citations: JSON.stringify(p02late.map((h) => ({ entity_type: "households", entity_id: h.id, label: h.name }))), model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", at: ts(ASOF - 1, 561) });
  }

  // -------------------------------------------------------------------------------------------
  settings() {
    const { add, c } = this;
    for (const a of HELP_ARTICLES) add("help_articles", { id: a.id, title: a.title, body: a.body, tags: JSON.stringify(a.tags), entity_type: a.entity_type, route: a.route, updated_at: "2026-10-30T16:00:00Z" });
    // Automation rules with run logs.
    const RULES: [string, string, object, object[], object, string | null, string][] = [
      ["Remind residents 3 days before rent is due", "Rule", { schedule: "0 15 28 * *", event: "charge.upcoming" }, [{ field: "autopay", op: "=", value: 0 }], { action: "households.send_reminder", params: { template_id: "tpl-rent-reminder" } }, null, "marcus"],
      ["Post late fees after the grace period", "Rule", { schedule: "0 14 * * *", event: "charge.overdue" }, [{ field: "days_late", op: ">", value: "grace_days" }], { action: "charges.post_late_fees", params: {} }, null, "grace"],
      ["Escalate emergencies after 2 hours", "Rule", { event: "wo.sla_risk" }, [{ field: "priority", op: "=", value: "Emergency" }], { action: "work_orders.escalate", params: { to_role: "maintenance_supervisor" } }, "maintenance_triage", "tom"],
      ["Request COI 30 days before expiry", "Rule", { event: "coi.expiring" }, [{ field: "days_to_expiry", op: "<=", value: 30 }], { action: "vendors.request_coi", params: { template_id: "tpl-coi-request" } }, "compliance", "tom"],
      ["Hold payments on vendor bank change", "Rule", { event: "vendor.bank_changed" }, [], { action: "vendors.hold_payments", params: { create_task: true } }, "ap", "grace"],
      ["Renewal workflow (120/90/60 days)", "Workflow", { schedule: "0 15 * * 1", event: "lease.expiring" }, [{ field: "days_to_end", op: "<=", value: 120 }], { action: "renewal_offers.send" }, "renewals", "marcus"],
      ["Move-out workflow", "Workflow", { event: "lease.notice_received" }, [], { action: "turnovers.create" }, null, "tom"],
      ["Thank-you text after a 5-star rating", "Rule", { event: "rating.created" }, [{ field: "stars", op: "=", value: 5 }], { action: "messages.send" }, null, "marcus"],
      ["Weekly data health digest", "Rule", { schedule: "0 13 * * 1" }, [], { action: "notifications.digest" }, "data_health", "sam"],
    ];
    RULES.forEach(([nm, kind, trigger, conditions, action, agent, by], i) => {
      const id = `auto-${i + 1}`;
      add("automation_rules", { id, name: nm, kind, trigger_spec: JSON.stringify(trigger), conditions: JSON.stringify(conditions), action: JSON.stringify(action), steps: kind === "Workflow" ? JSON.stringify(nm.startsWith("Renewal") ? [{ at: -120, do: "draft_offer" }, { at: -90, do: "send_offer" }, { at: -60, do: "reminder" }, { at: -45, do: "call_task" }] : [{ do: "schedule_move_out_inspection" }, { do: "create_turnover" }, { do: "list_unit" }, { do: "deposit_disposition" }]) : "[]", agent, enabled: i === 7 ? 0 : 1, scope_kind: "org", scope_id: null, created_by: by });
      const r = rng(`autorun:${id}`);
      for (let d = ASOF - 20; d <= ASOF; d++) {
        if (i === 7 || !r.chance(i < 3 ? 0.9 : 0.35)) continue;
        const p = pick(r, c.props);
        add("automation_runs", { id: `${id}-r${d}`, rule_id: id, started_at: ts(d, 840 + i * 3), status: r.weighted([["Succeeded", 85], ["Skipped", 8], ["Needs approval", 5], ["Failed", 2]] as const), entity_type: "properties", entity_id: p.id, property_id: p.id, detail: JSON.stringify({ matched: r.int(1, 40) }) });
      }
    });
    // Saved views, preferences, onboarding and tour progress.
    const VIEWS: [string, string, object][] = [
      ["work_orders", "Past SLA", { filters: { past_sla: "1" }, sort: ["sla_due_at", "asc"] }], ["work_orders", "Emergencies", { filters: { priority: "Emergency" } }],
      ["charges", "Overdue rent", { filters: { status: "Overdue", gl_account_id: "gl-4000" }, sort: ["due_on", "asc"] }], ["leases", "Expiring in 60 days", { filters: { expiring: "60" }, sort: ["end_on", "asc"] }],
      ["units", "Vacant 2-beds", { filters: { status: "Vacant", beds: "2" } }], ["bills", "Pending approval", { filters: { status: "Pending approval" }, sort: ["due_on", "asc"] }],
      ["prospects", "No contact in 3 days", { filters: { stale: "3" } }], ["data_issues", "Critical", { filters: { severity: "critical", status: "open" } }],
    ];
    VIEWS.forEach(([e, nm, state], i) => add("saved_views", { id: `sv-${i + 1}`, entity_type: e, name: nm, owner_id: null, state: JSON.stringify(state), position: i }));
    for (const sid of ["daniel", "priya", "marcus", "lena", "rachel", "grace", "tom", "sam", "nadia"]) add("user_preferences", { id: sid, density: sid === "grace" ? "Compact" : "Comfortable", theme: sid === "tom" ? "dark" : "light", tables: "{}", data: JSON.stringify({ recent: [] }) });
    const STEPS: [string, string, string | null][] = [["company_profile", "Done", "2023-02-14"], ["connect_bank", "Done", "2023-02-15"], ["import_portfolio", "Done", "2023-02-20"], ["invite_team", "Done", "2023-02-21"], ["set_roles", "Done", "2023-02-21"], ["payment_settings", "Done", "2023-03-01"], ["set_policies", "Todo", null], ["enable_agents", "Todo", null]];
    STEPS.forEach(([step, status, d]) => add("onboarding_progress", { id: `ob-org-${step}`, subject_kind: "org", subject_id: "org-summit", step, status, done_at: d ? `${d}T17:00:00Z` : null }));
    for (const [sid, tour, step, status] of [["marcus", "pm", 3, "Active"], ["grace", "accountant", 6, "Completed"], ["priya", "regional", 0, "Dismissed"], ["lena", "leasing", 2, "Active"]] as const) add("tour_progress", { id: `tp-${sid}-${tour}`, user_id: sid, tour, step, status, updated_at: ts(ASOF - 2, 700) });
    // Notifications for every persona (mix of read and unread).
    const NOTIF: [string, string, string, string][] = [
      ["marcus", "3 approvals waiting", "/app/ai/approvals", "Collections and Renewals proposals need you."], ["marcus", "Eviction hearing in 9 days", "/app/legal", "Barton Creek Commons."],
      ["priya", "3 concessions to approve", "/app/leasing/concessions?f.status=Proposed", "Lakewood Gardens, Frisco Station, Cedar Hollow."], ["grace", "Vendor bank details changed", "/app/data-health", "KeyRight Locksmiths changed bank details 3 days ago."],
      ["grace", "2 trust accounts unreconciled", "/app/banking/reconciliations", "October is open for Bluebonnet and Sonoran."], ["tom", "3 emergencies past SLA", "/app/maintenance/work-orders?view=past-sla", "Uptown Tower, Lakewood Gardens, Frisco Station."],
      ["rachel", "Applications waiting on you", "/app/leasing/applications?f.stage=Review", "Scored and ready for a decision."], ["lena", "Tours today", "/app/leasing/showings?view=today", "See today's schedule."],
      ["daniel", "October owner statements sent", "/app/owner-statements", "8 entities, all distributed."], ["sam", "Weekly data health digest", "/app/data-health", "New issues this week across 6 modules."],
      ["nadia", "Northgate Realty Group is past due", "/app/settings/platform", "Invoice 30 days overdue."], ["res-p01-0001", "Rent due Nov 1", "/portal/resident/pay", "Your November rent is ready to pay."],
      ["res-p01-0001", "AC repair scheduled", "/portal/resident/requests", "Hill Country HVAC, tomorrow 9–11."], ["v01", "New job assigned", "/portal/vendor/jobs", "Kitchen sink leak at The Lofts at Riverside."],
      ["ow01", "October statement ready", "/portal/owner/statements", "Bluebonnet Residential Fund II."], ["apl-0001", "Finish your application", "/portal/applicant", "Upload paystubs and pay the $55 fee."],
    ];
    NOTIF.forEach(([user, title, href, body], i) => add("notifications", { id: `nt-seed-${i + 1}`, user_id: user, channel: "In-app", title, body, href, entity_type: null, entity_id: null, read_at: i % 4 === 3 ? ts(ASOF - 1, 900) : null, at: ts(ASOF - (i % 3), 480 + i * 7) }));
    // Delinquency risk score on residents of households with balances.
    for (const h of c.households) {
      const owed = h.open.reduce((s, o) => s + Math.max(0, o.rem), 0);
      const lateCount = h.open.filter((o) => o.gl === "4100").length;
      const score = Math.min(99, Math.round((h.profile === "chronic" ? 55 : h.profile === "late" ? 30 : h.profile === "ontime" ? 10 : 4) + lateCount * 3 + owed / 20_000));
      for (const r of h.residents) r.risk_score = score;
    }
    // Audit history for staff actions (who did what), beyond money and AI.
    let au = 0;
    for (const b of c.bills.filter((b) => b.approved_at && (b.approved_at as string) >= iso(ASOF - 30))) add("audit", { id: `au-h-${++au}`, at: b.approved_at, actor: c.staffName[b.approved_by as string], actor_id: b.approved_by, role: "accountant", agent: null, model: null, action: "Bill approved", entity_type: "bills", entity_id: b.id, property_id: b.property_id, detail: `${b.id}: $${((b.amount_cents as number) / 100).toFixed(2)}`, before_json: JSON.stringify({ status: "Pending approval" }), after_json: JSON.stringify({ status: "Approved" }) });
    for (const r of (this.t.state_rules ?? []).filter((r) => r.changed_by)) add("audit", { id: `au-h-${++au}`, at: `${r.effective_from}T15:00:00Z`, actor: c.staffName[r.changed_by as string], actor_id: r.changed_by, role: "admin", agent: null, model: null, action: "State rule changed", entity_type: "state_rules", entity_id: r.id, property_id: null, detail: `${r.state} ${r.rule} = ${r.value}`, before_json: null, after_json: JSON.stringify({ value: r.value }) });
    add("audit", { id: `au-h-${++au}`, at: "2026-03-28T22:15:00Z", actor: "Sam Okafor", actor_id: "sam", role: "admin", agent: null, model: null, action: "User deactivated", entity_type: "staff", entity_id: "s-former", property_id: null, detail: "Brent Calloway (leasing agent) deactivated; access removed", before_json: JSON.stringify({ active: 1 }), after_json: JSON.stringify({ active: 0 }) });
  }

  // Funnel and AI figures in metrics_monthly from the generated rows.
  metricsFill() {
    const { c } = this;
    const count = (rows: R[] | undefined, key: (r: R) => string | null) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) {
        const k = key(r);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    const leads = count(this.t.prospects, (r) => `${r.property_id}|${(r.created_at as string).slice(0, 7)}`);
    const tours = count(this.t.showings, (r) => (r.status === "Completed" ? `${r.property_id}|${(r.scheduled_at as string).slice(0, 7)}` : null));
    const apps = count(this.t.applications, (r) => (r.submitted_at ? `${r.property_id}|${(r.submitted_at as string).slice(0, 7)}` : null));
    const ai = count(this.t.ai_proposals, (r) => (r.property_id ? `${r.property_id}|${(r.created_at as string).slice(0, 7)}` : null));
    for (const m of c.t.metrics_monthly) {
      const k = `${m.property_id}|${m.month}`;
      m.leads = leads.get(k) ?? 0;
      m.tours = tours.get(k) ?? 0;
      m.applications = apps.get(k) ?? 0;
      m.ai_actions = ai.get(k) ?? 0;
      m.ai_minutes_saved = (ai.get(k) ?? 0) * 6;
    }
    // Recompute wo_opened/wo_open for work orders added here (preventive, inspection, persona).
    const opened = count(c.workOrders, (w) => `${w.property_id}|${(w.opened_at as string).slice(0, 7)}`);
    for (const m of c.t.metrics_monthly) m.wo_opened = opened.get(`${m.property_id}|${m.month}`) ?? 0;
    const cur = c.t.metrics_monthly.filter((m) => m.month === "2026-11");
    for (const m of cur) m.wo_open = c.workOrders.filter((w) => w.property_id === m.property_id && !w.completed_at && w.status !== "Cancelled").length;
  }
}
