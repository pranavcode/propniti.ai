import { MANAGEMENT_FEE_RATE } from "../lib/ledger";
import { BANKS, COMMERCIAL_TENANTS, ENTITIES, FIRST, GL, LAST, METRO_STATE, ORG_ID, ORG_NAME, OWNERS, PROPERTY_SITE, STAFF, TECHS, UNICODE_NAMES, VENDORS, gl } from "./catalog";
import { AS_OF, BASE_VERSION, CURRENT_PERIOD, FIRST_PERIOD } from "./constants";
import { generateExtras } from "./extras";
import roster from "./roster.json";
import { addMonths, addMonthsDay, day, daysInMonth, hash32, iso, monthEnd, monthStart, pctOf, rng, round, ts, ym, type Rng } from "./rng";

// Deterministic base dataset (plan §3). Everything is generated in memory as rows keyed by table;
// src/server/base.ts writes them into SQLite and scripts/seed-d1.mjs into .seed/base.sql.
// Integer cents throughout. Money history ties out by construction: every charge, payment,
// credit, bill and transfer also posts a journal entry, and owner payouts close by seq cutoff.

export { AS_OF, BASE_VERSION, CURRENT_PERIOD, FIRST_PERIOD };
export const PERIODS = Array.from({ length: 19 }, (_, i) => addMonths(FIRST_PERIOD, i)); // 2025-05 … 2026-11
export const FEE_PCT = Math.round(MANAGEMENT_FEE_RATE * 100);

export const ASOF = day(AS_OF);
const WIN = monthStart(FIRST_PERIOD);

export type Value = string | number | null;
export type R = Record<string, Value>;
export type Tables = Record<string, R[]>;
export type Base = { tables: Tables; balances: { account_id: string; cleared_cents: number }[]; meta: Record<string, string> };

// ---------------------------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------------------------

export type Prop = {
  id: string; name: string; metro: string; state: string; region: string; entity: string; type: string; cls: string; year: number;
  stories: number; kind: "res" | "com" | "small"; units: Unit[]; manager: string; agent: string; techs: string[]; supervisor: string;
  trust: string; dep: string; graceDays: number; rubs: boolean; pool: boolean; gapMean: number; row: R; vendors: Record<string, string>;
};
export type Unit = {
  id: string; p: Prop; number: string; building: string; typeId: string; beds: number; baths: number; sqft: number; market: number;
  commercial: boolean; model: boolean; down: boolean; floor: number; leases: Lease[]; status: string; row: R;
};
export type Household = {
  id: string; p: Prop; name: string; profile: "autopay" | "ontime" | "late" | "chronic"; residents: R[]; split: boolean; pet: number; rubs: number;
  parking: { item: string; rent: number } | null; leases: Lease[]; open: Open[]; company?: string; plan?: boolean; evict?: boolean; last: string;
};
export type Lease = {
  id: string; u: Unit; hh: Household; start: number; end: number | null; moveOut: number | null; notice: number | null; rent: number; deposit: number;
  status: string; renewalOf: Lease | null; term: number | null; commercial: boolean; mtm: boolean; cam: number; tax: number; ins: number;
  concession: { label: string; monthly: number; months: string[] } | null; row: R; terminated?: boolean;
};
type Open = { id: string; rem: number; due: number; lease: Lease; gl: string; amount: number };

export type Ctx = {
  t: Tables; add: (table: string, row: R) => R; props: Prop[]; units: Unit[]; leases: Lease[]; households: Household[];
  staffName: Record<string, string>; vendorName: Record<string, string>; vendorTrade: Record<string, string>;
  je: (prop: string, glNo: string, period: string, dr: number, cr: number) => void; next: (k: string) => number;
  workOrders: R[]; bills: R[]; transfers: R[]; propById: Record<string, Prop>; unitById: Record<string, Unit>; leaseById: Record<string, Lease>;
  // Corrupted cases planted inside the ledger (rule → record ids), so data_issues can point at them.
  planted: Record<string, string[]>; woN: number;
  bill: (p: Prop, vendor: string, lines: [glNo: string, description: string, amount: number][], billDate: number, opts?: { wo?: string; recurring?: string; po?: string; termsDays?: number; status?: string; doc?: string }) => R | null;
  // Set once the ledger is closed; later work orders (extras) never create bills or payouts.
  sealed: boolean;
};

const COMMERCIAL = new Set(["Retail strip", "Office", "Industrial flex"]);
const BASE_1BR: Record<string, number> = { Austin: 127_500, Dallas: 122_500, Atlanta: 130_000, Phoenix: 115_000 };
const CLASS_X: Record<string, number> = { A: 1.3, B: 1.0, C: 0.82 };
// Market rent drifts from +1% (May 2025) to flat (Nov 2026): "YoY flat to −2%".
const marketAt = (u: Unit, d: number) => round(u.market * (1 + 0.01 * Math.max(0, ASOF - d) / 550), 500);

export function generate(): Base {
  const t: Tables = {};
  const add = (table: string, row: R) => ((t[table] ??= []).push(row), row);
  const counters: Record<string, number> = {};
  const next = (k: string) => (counters[k] = (counters[k] ?? 0) + 1);
  const jeMap = new Map<string, [number, number]>();
  const je = (prop: string, glNo: string, period: string, dr: number, cr: number) => {
    const k = `${prop}|${glNo}|${period}`;
    const v = jeMap.get(k);
    if (v) {
      v[0] += dr;
      v[1] += cr;
    }
    else jeMap.set(k, [dr, cr]);
  };
  const ctx: Ctx = {
    t, add, props: [], units: [], leases: [], households: [], staffName: {}, vendorName: {}, vendorTrade: {}, je, next,
    workOrders: [], bills: [], transfers: [], propById: {}, unitById: {}, leaseById: {}, planted: {}, woN: 10000, sealed: false, bill: () => null,
  };

  org(ctx);
  assets(ctx);
  for (const u of ctx.units) simulateUnit(ctx, u);
  people(ctx);
  ledger(ctx);
  operations(ctx);
  ownerPayouts(ctx);

  // Journal entries: one row per property × GL × period.
  const entityOf = Object.fromEntries(ctx.props.map((p) => [p.id, p.entity]));
  for (const [k, [dr, cr]] of [...jeMap].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!dr && !cr) continue;
    const [prop, glNo, period] = k.split("|");
    add("journal_entries", { id: `je-${prop}-${glNo}-${period}`, property_id: prop, owner_entity_id: entityOf[prop], gl_account_id: gl(glNo), period, debit_cents: dr, credit_cents: cr, memo: `${period} summary` });
  }
  budgetsAndMetrics(ctx, jeMap);
  ctx.sealed = true;
  generateExtras(ctx);
  storeBalances(ctx);
  capToToday(t);

  // Transfers go in chronological order so seq order is time order (owner statements close by seq).
  t.transfers.sort((a, b) => (a.created === b.created ? (a.id! < b.id! ? -1 : 1) : a.created! < b.created! ? -1 : 1));
  const balances = new Map<string, number>();
  for (const x of t.transfers) {
    if (x.status !== "Cleared") continue;
    const sign = INFLOW.has(x.kind as string) ? 1 : -1;
    balances.set(x.bank_account_id as string, (balances.get(x.bank_account_id as string) ?? 0) + sign * (x.amount_cents as number));
  }
  const meta = { base_version: BASE_VERSION, as_of: AS_OF, first_period: FIRST_PERIOD, generated_at: `${AS_OF}T06:00:00Z` };
  return { tables: t, balances: [...balances].sort().map(([account_id, cleared_cents]) => ({ account_id, cleared_cents })), meta };
}

export const INFLOW = new Set(["Rent", "Deposit", "Other receipt"]);

// Columns that record something that already happened. On the demo's "today" they are squeezed
// into 00:00–08:00 (order kept) and never land after it, so the UI never shows a past event as
// "later today" or "tomorrow". Scheduled columns (due, SLA, scheduled_at, send_at, expiry) are left.
const PAST_COLUMNS = new Set([
  "created_at", "created", "cleared", "at", "opened_at", "completed_at", "sent_at", "submitted_at", "decided_at", "detected_at", "fixed_at",
  "started_at", "ended_at", "generated_at", "uploaded_at", "approved_at", "signed_at", "last_contact_at", "last_message_at", "responded_at",
  "taken_at", "processed_at", "read_at", "last_active_at", "updated_at", "done_at", "completed_at",
]);
export const TODAY_CAP = `${AS_OF}T08:00:00Z`;
function capToToday(t: Tables) {
  for (const rows of Object.values(t)) {
    for (const r of rows) {
      for (const k in r) {
        const v = r[k];
        if (typeof v !== "string" || v.length < 16 || v[10] !== "T" || !PAST_COLUMNS.has(k)) continue;
        if (v.startsWith(AS_OF)) {
          const minutes = Math.floor((Number(v.slice(11, 13)) * 60 + Number(v.slice(14, 16))) / 3);
          r[k] = `${AS_OF}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:${v.slice(17, 19) || "00"}Z`;
        } else if (v > TODAY_CAP) r[k] = TODAY_CAP;
      }
    }
  }
}

// Stored balances for list views: charges − payments (not NSF) − credits, per lease and household,
// as the rows stand after corrupted cases are planted (a misposted payment counts where it is posted).
function storeBalances(c: Ctx) {
  const lease = new Map<string, number>(), hh = new Map<string, number>(), lastL = new Map<string, string>(), lastH = new Map<string, string>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const householdOf = new Map(c.t.leases.map((l) => [l.id as string, l.household_id as string]));
  for (const x of c.t.charges) {
    bump(lease, x.lease_id as string, x.amount_cents as number);
    bump(hh, x.household_id as string, x.amount_cents as number);
  }
  for (const x of c.t.payments) {
    if (x.nsf) continue;
    bump(lease, x.lease_id as string, -(x.amount_cents as number));
    bump(hh, x.household_id as string, -(x.amount_cents as number));
    const d = x.received_on as string;
    if (d > (lastL.get(x.lease_id as string) ?? "")) lastL.set(x.lease_id as string, d);
    if (d > (lastH.get(x.household_id as string) ?? "")) lastH.set(x.household_id as string, d);
  }
  for (const x of c.t.credits) {
    bump(lease, x.lease_id as string, -(x.amount_cents as number));
    bump(hh, householdOf.get(x.lease_id as string)!, -(x.amount_cents as number));
  }
  for (const l of c.t.leases) Object.assign(l, { balance_cents: lease.get(l.id as string) ?? 0, last_payment_at: lastL.get(l.id as string) ?? null });
  for (const h of c.t.households) Object.assign(h, { balance_cents: hh.get(h.id as string) ?? 0, last_payment_at: lastH.get(h.id as string) ?? null });
}

// Content hash of a generated base (determinism test and meta.base_hash).
export function baseHash(b: Base) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const feed = (s: string) => {
    h1 = Math.imul(h1 ^ hash32(s), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ hash32(`${s}#`), 2246822519) >>> 0;
  };
  for (const name of Object.keys(b.tables).sort()) for (const row of b.tables[name]) feed(name + JSON.stringify(row));
  feed(JSON.stringify(b.balances));
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------------------------
// Org, owners, banking, staff, GL
// ---------------------------------------------------------------------------------------------

function org(c: Ctx) {
  const { add } = c;
  add("orgs", { id: ORG_ID, name: ORG_NAME, plan: "Enterprise", status: "Active", seats: 48, units_managed: 3318, created_at: "2023-02-14T16:00:00Z" });
  const others: [string, string, string, string, number, number][] = [
    ["org-cypress", "Cypress Lane Living", "Growth", "Active", 22, 1140],
    ["org-harbor", "Harbor & Pine Property Co.", "Enterprise", "Active", 61, 4820],
    ["org-mesa", "Mesa Verde Management", "Starter", "Trial", 6, 212],
    ["org-northgate", "Northgate Realty Group", "Growth", "Past due", 18, 960],
  ];
  for (const [id, name, plan, status, seats, units] of others) add("orgs", { id, name, plan, status, seats, units_managed: units, created_at: "2024-06-01T16:00:00Z" });
  add("regions", { id: "r-tx", org_id: ORG_ID, name: "Texas", states: '["TX"]' });
  add("regions", { id: "r-se", org_id: ORG_ID, name: "Southeast", states: '["GA"]' });
  add("regions", { id: "r-sw", org_id: ORG_ID, name: "Southwest", states: '["AZ"]' });
  for (const [id, name, kind, email] of OWNERS) add("owners", { id, name, kind, email, phone: `(512) 555-01${id.slice(2)}`, portal_enabled: 1 });
  const banks = rng("banks");
  for (const [id, owner, name, state, reserve] of ENTITIES) {
    add("owner_entities", {
      id, org_id: ORG_ID, owner_id: owner, name, ein_last4: String(banks.int(1000, 9999)), state, mgmt_fee_pct: MANAGEMENT_FEE_RATE,
      reserve_cents: reserve * 100, agreement_signed_on: iso(day("2023-03-01") + banks.int(0, 500)), agreement_signed_by: "rachel",
    });
    add("portfolios", { id: `pf-${id}`, org_id: ORG_ID, owner_entity_id: id, name: name.replace(/, LLC$/, "") + " portfolio" });
    const bank = banks.pick(BANKS);
    add("bank_accounts", { id: `ba-${id}-trust`, owner_entity_id: id, name: `${name.replace(/, LLC$/, "")} — operating trust`, kind: "Trust", bank, last4: String(banks.int(1000, 9999)), gl_account_id: gl("1010") });
    add("bank_accounts", { id: `ba-${id}-dep`, owner_entity_id: id, name: `${name.replace(/, LLC$/, "")} — security deposits`, kind: "Deposit", bank, last4: String(banks.int(1000, 9999)), gl_account_id: gl("1020") });
  }
  add("bank_accounts", { id: "ba-mgmt", owner_entity_id: null, name: `${ORG_NAME} — operating`, kind: "Operating", bank: "Frost Bank", last4: "4471", gl_account_id: null });

  for (const [number, name, type, parent] of GL) add("gl_accounts", { id: gl(number), number, name, type, parent_id: parent ? gl(parent) : null });

  const st = rng("staff");
  const email = (name: string) => `${name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").join(".")}@summitresidential.example`;
  for (const [id, name, title, role, kind, ids] of STAFF) {
    c.staffName[id] = name;
    add("staff", { id, org_id: ORG_ID, name, title, email: email(name), phone: `(512) 555-${String(st.int(1000, 9999))}`, avatar: null, active: 1, last_active_at: ts(ASOF - st.int(0, 2), st.int(420, 1100)) });
    if (kind === "property" || kind === "region") for (const s of ids) add("role_assignments", { id: `ra-${id}-${s}`, staff_id: id, role, scope_kind: kind, scope_id: s });
    else add("role_assignments", { id: `ra-${id}`, staff_id: id, role, scope_kind: kind, scope_id: kind === "org" ? ORG_ID : null });
  }
  for (const [id, name, props] of TECHS) {
    c.staffName[id] = name;
    add("staff", { id, org_id: ORG_ID, name, title: "Maintenance technician", email: email(name), phone: `(512) 555-${String(st.int(1000, 9999))}`, avatar: null, active: 1, last_active_at: ts(ASOF, st.int(420, 1000)) });
    for (const s of props) add("role_assignments", { id: `ra-${id}-${s}`, staff_id: id, role: "maintenance_supervisor", scope_kind: "property", scope_id: s });
  }
  // A deactivated user keeps history but can't sign in.
  c.staffName["s-former"] = "Brent Calloway";
  add("staff", { id: "s-former", org_id: ORG_ID, name: "Brent Calloway", title: "Leasing agent (former)", email: email("Brent Calloway"), phone: "", avatar: null, active: 0, last_active_at: "2026-03-28T22:10:00Z" });

  const vr = rng("vendors");
  for (const [id, company, trade, contact, metros, is1099] of VENDORS) {
    c.vendorName[id] = company;
    c.vendorTrade[id] = trade;
    add("vendors", {
      id, company, trade, contact_name: contact, email: `ap@${company.toLowerCase().replace(/[^a-z]/g, "").slice(0, 18)}.example`,
      phone: `(${metros[0] === "Atlanta" ? 404 : metros[0] === "Phoenix" ? 602 : metros[0] === "Dallas" ? 214 : 512}) 555-${String(vr.int(1000, 9999))}`,
      metros: JSON.stringify(metros), w9_on_file: is1099 ? (vr.chance(0.94) ? 1 : 0) : 0, tin_last4: is1099 ? String(vr.int(1000, 9999)) : "",
      is_1099: is1099 ? 1 : 0, bank_last4: String(vr.int(1000, 9999)), bank_changed_at: null, rating: is1099 ? Math.round((3.6 + vr() * 1.35) * 10) / 10 : null,
      status: "Active",
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Properties, buildings, unit types, units
// ---------------------------------------------------------------------------------------------

type TypeSpec = [code: string, beds: number, baths: number, sqft: number, mult: number, share: number];
const MIX: Record<string, TypeSpec[]> = {
  rise: [["S1", 0, 1, 540, 0.82, 0.12], ["A1", 1, 1, 710, 1, 0.36], ["A2", 1, 1, 790, 1.07, 0.14], ["B1", 2, 2, 1090, 1.3, 0.28], ["C1", 3, 2, 1360, 1.62, 0.1]],
  garden: [["A1", 1, 1, 730, 1, 0.34], ["A2", 1, 1, 820, 1.06, 0.14], ["B1", 2, 2, 1060, 1.3, 0.34], ["B2", 2, 2, 1160, 1.38, 0.06], ["C1", 3, 2, 1310, 1.58, 0.12]],
  town: [["B1", 2, 2.5, 1260, 1.42, 0.5], ["C1", 3, 2.5, 1560, 1.75, 0.5]],
  duplex: [["B1", 2, 1, 960, 1.18, 1]],
  bungalow: [["C1", 3, 2, 1420, 1.55, 1]],
};
const AMENITIES: Record<string, string[]> = {
  rise: ["Rooftop deck", "Fitness center", "Package lockers", "Controlled access", "Co-working lounge", "Pet spa", "EV charging", "Structured parking"],
  garden: ["Resort-style pool", "Fitness center", "Dog park", "Clubhouse", "Grilling stations", "Package lockers", "Playground"],
  town: ["Attached garages", "Private yards", "Pool", "Walking trails", "Package lockers"],
  small: ["Private yards", "In-unit laundry", "Off-street parking"],
  com: ["Ample parking", "Monument signage", "24/7 access", "Fiber internet", "Loading docks"],
};

function assets(c: Ctx) {
  const { add } = c;
  const managers: Record<string, string> = {};
  const agents: Record<string, string> = {};
  for (const [id, , , role, , ids] of STAFF) for (const p of ids) {
    if (role === "property_manager") managers[p] ??= id;
    if (role === "leasing_agent") agents[p] ??= id;
  }
  const techsFor = (p: string) => TECHS.filter(([, , ps]) => ps.includes(p)).map(([id]) => id);
  for (const ro of roster as { id: string; name: string; metro: string; neighborhood: string; type: string; cls: string; yearBuilt: number; units: number }[]) {
    const [street, city, zip, lat, lng, stories, entity] = PROPERTY_SITE[ro.id];
    const ms = METRO_STATE[ro.metro];
    const r = rng(`prop:${ro.id}`);
    const kind: Prop["kind"] = COMMERCIAL.has(ro.type) ? "com" : ro.type === "Small residential" ? "small" : "res";
    const style = kind === "com" ? "com" : kind === "small" ? "small" : ro.type.includes("rise") || ro.type === "Mixed-use" ? "rise" : ro.type === "Townhomes" ? "town" : "garden";
    const vendorFor = (trade: string) => VENDORS.find(([, , tr, , metros]) => tr === trade && metros.includes(ro.metro))?.[0] ?? "v42";
    const p: Prop = {
      id: ro.id, name: ro.name, metro: ro.metro, state: ms.state, region: ms.region, entity, type: ro.type, cls: ro.cls, year: ro.yearBuilt, stories, kind,
      units: [], manager: managers[ro.id] ?? "marcus", agent: agents[ro.id] ?? "s-yusuf", techs: techsFor(ro.id),
      supervisor: ms.region === "r-tx" ? "tom" : ms.region === "r-se" ? "s-rosa" : "s-hank",
      trust: `ba-${entity}-trust`, dep: `ba-${entity}-dep`, graceDays: ms.state === "TX" ? 2 : ms.state === "GA" ? 5 : 3,
      rubs: kind !== "com" && (ro.cls !== "A" || ro.metro === "Phoenix"), pool: style === "garden" || ro.id === "p25" || ro.id === "p01",
      gapMean: ro.cls === "C" ? 48 : ro.cls === "B" ? 34 : 28, row: {}, vendors: {},
    };
    for (const trade of ["Plumbing", "HVAC", "Electrical", "Landscaping", "Turn", "Appliance", "Pest control", "Elevator", "Roofing", "Pool", "General contractor", "Locksmith", "Flooring", "Trash", "Utilities", "Insurance", "Marketing", "Property tax", "General"]) p.vendors[trade] = vendorFor(trade);
    p.vendors.Appliance = ro.metro === "Dallas" || ro.metro === "Austin" ? "v09" : p.vendors["General contractor"];
    p.vendors.Electric = ro.metro === "Atlanta" ? "v37" : ro.metro === "Phoenix" ? "v38" : "v36";
    c.props.push(p);
    c.propById[p.id] = p;
    const photos = (kind === "com" ? ["", "-alt", "-interior", "-aerial"] : ["", "-alt", "-court", "-interior"]).map((s) => `/img/props/${ro.id}${s}.webp`);
    p.row = add("properties", {
      id: ro.id, org_id: ORG_ID, region_id: ms.region, portfolio_id: `pf-${entity}`, owner_entity_id: entity, manager_id: p.manager, name: ro.name, type: ro.type,
      class: ro.cls, metro: ro.metro, neighborhood: ro.neighborhood, street, city, state: ms.state, zip, lat, lng, year_built: ro.yearBuilt, stories,
      unit_count: ro.units, rentable_sqft: 0, amenities: JSON.stringify(AMENITIES[style].filter((a) => !(a.includes("ool") && !p.pool)).slice(0, 6)), photos: JSON.stringify(photos),
      acquired_on: iso(day(`${Math.max(ro.yearBuilt, 2016)}-06-01`) + r.int(0, 900)), status: ro.id === "p11" ? "Lease-up" : ro.id === "p28" ? "Renovation" : "Stabilized",
    });

    // Buildings
    const bCount = style === "garden" ? Math.ceil(ro.units / 24) : style === "town" ? Math.ceil(ro.units / 8) : style === "small" ? (ro.id === "p21" ? ro.units : Math.ceil(ro.units / 2)) : 1;
    for (let b = 1; b <= bCount; b++) add("buildings", { id: `b-${ro.id}-${b}`, property_id: ro.id, name: bCount === 1 ? "Main building" : style === "small" ? `${Number(street.split(" ")[0]) + (b - 1) * 4} ${street.split(" ").slice(1).join(" ")}` : `Building ${b}`, floors: style === "garden" ? 3 : stories });

    if (kind === "com") {
      commercialSuites(c, p, ro.units, r);
    } else {
      const mixKey = style === "small" ? (ro.id === "p21" ? "bungalow" : "duplex") : style;
      const mix = MIX[mixKey];
      const base1 = BASE_1BR[ro.metro] * CLASS_X[ro.cls] * (style === "town" ? 1.08 : 1);
      for (const [code, beds, baths, sqft, mult] of mix) {
        add("unit_types", {
          id: `ut-${ro.id}-${code}`, property_id: ro.id, name: `${code} · ${beds ? `${beds} bed` : "Studio"}`, beds, baths, sqft, market_rent_cents: round(base1 * mult, 500),
          photos: JSON.stringify(["living", "kitchen", "bedroom", "bathroom"].map((room) => `/img/units/unit-${ro.cls.toLowerCase()}-${room}.webp`)),
          floorplan_svg: floorplan(beds, baths, sqft),
        });
      }
      const mixedRetail = ro.type === "Mixed-use" ? 8 : 0;
      const resUnits = ro.units - mixedRetail;
      // Assign types by share, deterministic order.
      const types: TypeSpec[] = [];
      for (const spec of mix) for (let i = 0; i < Math.round(spec[5] * resUnits); i++) types.push(spec);
      while (types.length < resUnits) types.push(mix[1] ?? mix[0]);
      types.length = resUnits;
      const floors = style === "rise" ? stories : style === "garden" ? 3 : style === "town" ? 1 : 1;
      const perFloor = Math.ceil(resUnits / floors);
      for (let i = 0; i < resUnits; i++) {
        const spec = types[(i * 7) % resUnits];
        let number: string, floor: number, building: string;
        if (style === "rise") {
          floor = Math.floor(i / perFloor) + (mixedRetail ? 2 : 1);
          number = String(floor * 100 + (i % perFloor) + 1);
          building = `b-${ro.id}-1`;
        } else if (style === "garden") {
          const b = Math.floor(i / 24) + 1;
          floor = Math.floor((i % 24) / 8) + 1;
          number = `${b}${floor}${String((i % 8) + 1).padStart(2, "0")}`;
          building = `b-${ro.id}-${b}`;
        } else if (style === "town") {
          const b = Math.floor(i / 8) + 1;
          floor = 1;
          number = `${String.fromCharCode(64 + b)}${(i % 8) + 1}`;
          building = `b-${ro.id}-${b}`;
        } else {
          const b = ro.id === "p21" ? i + 1 : Math.floor(i / 2) + 1;
          floor = 1;
          number = ro.id === "p21" ? `${b}` : `${b}${i % 2 ? "B" : "A"}`;
          building = `b-${ro.id}-${b}`;
        }
        const ur = rng(`unitspec:${ro.id}:${number}`);
        const sqft = Math.round(spec[3] * (0.97 + ur() * 0.06));
        const market = round(base1 * spec[4] * (1 + (floor - 1) * 0.006) * (0.98 + ur() * 0.04), 500);
        addUnit(c, p, { number, building, typeId: `ut-${ro.id}-${spec[0]}`, beds: spec[1], baths: spec[2], sqft, market, commercial: false, floor });
      }
      for (let i = 0; i < mixedRetail; i++) {
        const sqft = 1200 + rng(`suite:${ro.id}:${i}`).int(0, 14) * 100;
        addUnit(c, p, { number: `Suite ${101 + i}`, building: `b-${ro.id}-1`, typeId: null, beds: 0, baths: 1, sqft, market: round((sqft * 3400) / 12, 500), commercial: true, floor: 1 });
      }
      // Model unit in large communities; a few down units (fire or water damage).
      const big = p.units.filter((u) => !u.commercial);
      if (big.length > 150) big[3].model = true;
      if (["p09", "p16", "p28"].includes(ro.id)) big[17].down = true;
    }
    p.row.rentable_sqft = p.units.reduce((s, u) => s + u.sqft, 0);
  }
}


function addUnit(c: Ctx, p: Prop, u: { number: string; building: string; typeId: string | null; beds: number; baths: number; sqft: number; market: number; commercial: boolean; floor: number }) {
  const id = `u-${p.id}-${u.number.replace(/\s+/g, "").toLowerCase()}`;
  const unit: Unit = { id, p, number: u.number, building: u.building, typeId: u.typeId ?? "", beds: u.beds, baths: u.baths, sqft: u.sqft, market: u.market, commercial: u.commercial, model: false, down: false, floor: u.floor, leases: [], status: "Vacant", row: {} };
  unit.row = c.add("units", { id, property_id: p.id, building_id: u.building, unit_type_id: u.typeId, number: u.number, floor: u.floor, sqft: u.sqft, market_rent_cents: u.market, status: "Vacant", available_on: null });
  p.units.push(unit);
  c.units.push(unit);
  c.unitById[id] = unit;
}

function commercialSuites(c: Ctx, p: Prop, n: number, r: Rng) {
  const rate = p.type === "Office" ? (p.cls === "A" ? 3600 : 2700) : p.type === "Retail strip" ? (p.cls === "A" ? 3400 : 2600) : p.cls === "A" ? 1300 : 1050; // cents per sf per year
  for (let i = 0; i < n; i++) {
    const sqft = p.type === "Industrial flex" ? 6000 + r.int(0, 24) * 1000 : p.type === "Office" ? 1800 + r.int(0, 40) * 150 : 1100 + r.int(0, 30) * 100;
    const floor = p.type === "Office" ? Math.floor(i / Math.ceil(n / p.stories)) + 1 : 1;
    const number = p.type === "Office" ? `Suite ${floor}${String((i % Math.ceil(n / p.stories)) + 1).padStart(2, "0")}` : p.type === "Industrial flex" ? `Bay ${i + 1}` : `Suite ${101 + i}`;
    addUnit(c, p, { number, building: `b-${p.id}-1`, typeId: null, beds: 0, baths: 1, sqft, market: round((sqft * rate) / 12, 500), commercial: true, floor });
  }
}

function floorplan(beds: number, baths: number, sqft: number) {
  const w = 300, h = 200;
  const rooms = beds ? [["Living", 0, 0, 160, 120], ["Kitchen", 160, 0, 140, 80], ...Array.from({ length: beds }, (_, i) => [`Bedroom ${i + 1}`, i * (300 / beds), 120, 300 / beds, 80]), ["Bath", 160, 80, 70, 40]] : [["Studio", 0, 0, 200, 200], ["Kitchen", 200, 0, 100, 110], ["Bath", 200, 110, 100, 90]];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="none" stroke="currentColor" stroke-width="2">${rooms.map(([n, x, y, rw, rh]) => `<rect x="${x}" y="${y}" width="${rw}" height="${rh}"/><text x="${Number(x) + 8}" y="${Number(y) + 18}" font-size="11" fill="currentColor" stroke="none">${n}</text>`).join("")}<text x="8" y="${h - 6}" font-size="10" fill="currentColor" stroke="none">${sqft} sq ft · ${beds || "Studio"}${beds ? " bd" : ""} · ${baths} ba</text></svg>`;
}

// ---------------------------------------------------------------------------------------------
// Leases (per-unit timeline) and households
// ---------------------------------------------------------------------------------------------

const PROFILES: [Household["profile"], number][] = [["autopay", 41], ["ontime", 47.5], ["late", 8], ["chronic", 3.5]];

function newHousehold(c: Ctx, p: Prop, commercial: boolean): Household {
  const n = c.next(`hh:${p.id}`);
  const id = `hh-${p.id}-${String(n).padStart(4, "0")}`;
  const hr = rng(`hh:${id}`);
  const company = commercial ? hr.pick(COMMERCIAL_TENANTS[p.type === "Mixed-use" ? "Retail strip" : p.type] ?? COMMERCIAL_TENANTS["Retail strip"]) : undefined;
  const last = hr.pick(LAST);
  const hh: Household = {
    id, p, name: company ?? `${last} household`, profile: commercial ? (hr.chance(0.9) ? "ontime" : "late") : hr.weighted(PROFILES), residents: [],
    split: false, pet: !commercial && hr.chance(0.16) ? hr.pick([3500, 4000, 5000]) : 0, rubs: p.rubs && !commercial ? 3800 + hr.int(0, 34) * 100 : 0,
    parking: null, leases: [], open: [], company, last,
  };
  // Residents are created after simulation (ids are numbered per property in a stable order).
  c.households.push(hh);
  return hh;
}

function pickTerm(r: Rng) {
  return r.weighted([[12, 70], [13, 6], [14, 4], [15, 5], [6, 4], [9, 5], [18, 6]] as const);
}

function makeLease(c: Ctx, u: Unit, hh: Household, start: number, end: number | null, rent: number, renewalOf: Lease | null, term: number | null): Lease {
  const l: Lease = {
    id: `L-${10000 + c.next("lease")}`, u, hh, start, end, moveOut: null, notice: null, rent, deposit: 0, status: "Active", renewalOf, term,
    commercial: u.commercial, mtm: false, cam: 0, tax: 0, ins: 0, concession: null, row: {},
  };
  l.deposit = renewalOf ? renewalOf.deposit : u.commercial ? rent * 2 : rent >= 200_000 ? round(rent * 0.75, 2500) : round(Math.min(rent, 75_000 + Math.floor(rent / 400) * 2500), 2500);
  u.leases.push(l);
  hh.leases.push(l);
  return l;
}

function simulateUnit(c: Ctx, u: Unit) {
  if (u.model) return (u.status = u.row.status = "Model"), undefined;
  const r = rng(`unit:${u.id}`);
  const p = u.p;
  if (u.commercial) return simulateSuite(c, u, r);
  let start: number;
  if (p.id === "p11") start = day("2024-10-01") + r.int(0, 845);
  else {
    // Start month weighted toward May–August so expirations bunch in summer.
    const offset = r.weighted(Array.from({ length: 18 }, (_, i) => [i, [4, 5, 6, 7].includes((10 + i) % 12) ? 2.4 : 1] as const));
    start = monthStart(addMonths("2023-11", offset)) + (r.chance(0.7) ? 0 : r.int(1, 27));
  }
  let hh = newHousehold(c, p, false);
  let rent = marketAt(u, start);
  let prev: Lease | null = null;
  for (let guard = 0; guard < 12; guard++) {
    if (start > ASOF) {
      if (start - ASOF < 40 && r.chance(0.55)) {
        const term = pickTerm(r);
        const l = makeLease(c, u, hh, start, addMonthsDay(start, term) - 1, rent, null, term);
        l.status = "Future";
      }
      break;
    }
    const term = pickTerm(r);
    const end = addMonthsDay(start, term) - 1;
    const l = makeLease(c, u, hh, start, end, rent, prev && prev.hh === hh ? prev : null, term);
    if (end >= ASOF) {
      if (end - ASOF < 80 && r.chance(0.38)) {
        l.notice = Math.min(ASOF - r.int(0, 20), end - 30);
        l.moveOut = end;
        l.status = "Notice";
      }
      break;
    }
    const roll = r();
    if (roll < 0.55) {
      prev = l;
      l.status = "Expired";
      start = end + 1;
      const bump = start < day("2026-01-01") ? r.normal(0.028, 0.012) : r.normal(0.012, 0.012);
      rent = round(rent * (1 + Math.max(-0.02, Math.min(0.06, bump))), 500);
      continue;
    }
    if (roll < 0.62) {
      // Month-to-month after the term, at a premium; some still on it today.
      l.mtm = true;
      const months = r.int(1, 14);
      const out = addMonthsDay(end + 1, months) - 1;
      if (out >= ASOF) {
        l.status = "Month-to-month";
        if (r.chance(0.25)) {
          l.notice = ASOF - r.int(1, 25);
          l.moveOut = Math.max(ASOF + 5, l.notice + 30);
          l.status = "Notice";
        }
        break;
      }
      l.moveOut = out;
      l.status = "Expired";
    } else if (roll < 0.635) {
      l.moveOut = end - r.int(30, 150);
      l.terminated = true;
      l.status = "Terminated";
    } else {
      l.moveOut = end;
      l.status = "Expired";
    }
    const gap = r.chance(0.03) ? r.int(95, 160) : Math.round(-Math.log(1 - r()) * p.gapMean) + 6;
    start = l.moveOut! + gap;
    hh = newHousehold(c, p, false);
    rent = marketAt(u, start);
    prev = null;
  }
  // Physical status today.
  const cur = u.leases.find((l) => l.start <= ASOF && (l.moveOut ?? l.end ?? Infinity) >= ASOF && l.status !== "Future" && (l.end === null || l.end >= ASOF || l.mtm || l.status === "Notice"));
  const last = u.leases.filter((l) => l.moveOut && l.moveOut < ASOF).at(-1);
  if (u.down) u.status = "Down";
  else if (cur) u.status = cur.status === "Notice" ? "Notice" : "Occupied";
  else if (last && ASOF - last.moveOut! < 12) u.status = "Make-ready";
  else u.status = "Vacant";
  if (u.down && cur) cur.status = "Active";
  u.row.status = u.status;
  u.row.available_on = u.status === "Vacant" || u.status === "Make-ready" ? iso(Math.max(ASOF, (last?.moveOut ?? ASOF) + 10)) : u.status === "Notice" && cur?.moveOut ? iso(cur.moveOut + 10) : null;
}

function simulateSuite(c: Ctx, u: Unit, r: Rng) {
  const vacant = r.chance(u.p.type === "Office" ? 0.12 : 0.08);
  let term = r.pick([36, 60, 60, 84, 120]);
  let start = monthStart(addMonths("2019-01", r.int(0, 76)));
  while (addMonthsDay(start, term) - 1 < WIN) start = addMonthsDay(start, term);
  const hh = newHousehold(c, u.p, true);
  let prev: Lease | null = null;
  let l!: Lease;
  for (;;) {
    const rent = round(u.market / Math.pow(1.03, Math.max(0, (ASOF - start) / 365)), 500);
    let end = addMonthsDay(start, term) - 1;
    if (vacant) end = Math.min(end, ASOF - r.int(60, 300));
    l = makeLease(c, u, hh, start, end, rent, prev, term);
    l.cam = round((u.sqft * (u.p.type === "Industrial flex" ? 210 : 640)) / 12, 100);
    l.tax = round((u.sqft * (u.p.state === "TX" ? 420 : 260)) / 12, 100);
    l.ins = round((u.sqft * 85) / 12, 100);
    if (vacant || end >= ASOF) break;
    // Commercial tenants renew at term end (5-year renewal at market).
    l.status = "Expired";
    prev = l;
    start = end + 1;
    term = 60;
  }
  const end = l.end!;
  if (end < ASOF) {
    l.moveOut = end;
    l.status = "Expired";
    u.status = "Vacant";
  } else {
    u.status = "Occupied";
    l.status = "Active";
    if (end - ASOF < 120 && r.chance(0.5)) {
      l.notice = ASOF - r.int(10, 60);
      l.moveOut = end;
      l.status = u.status = "Notice";
    }
  }
  u.row.status = u.status;
  u.row.available_on = u.status === "Vacant" ? iso(ASOF + 14) : null;
}

// Commercial escalations: +3% on each lease anniversary.
export const suiteRentAt = (l: Lease, d: number) => round(l.rent * Math.pow(1.03, Math.max(0, Math.floor((d - l.start) / 365.25))), 100);

function people(c: Ctx) {
  const { add } = c;
  // Only leases that touch the history window are kept.
  const inWindow = (l: Lease) => l.status === "Future" || (l.moveOut ?? (l.mtm ? Infinity : l.end ?? Infinity)) >= WIN;
  for (const u of c.units) u.leases = u.leases.filter(inWindow);
  for (const hh of c.households) hh.leases = hh.leases.filter(inWindow);
  c.households = c.households.filter((h) => h.leases.length);
  // Number households per property in a stable order; the resident persona (Jordan Lee, p01 #412)
  // must be res-p01-0001.
  for (const p of c.props) {
    const hhs = c.households.filter((h) => h.p === p && h.leases.length);
    const jordan = p.id === "p01" ? hhs.find((h) => h.leases.some((l) => l.u.number === "412" && l.status !== "Expired" && l.status !== "Future" && l.status !== "Terminated")) : undefined;
    if (jordan) {
      hhs.splice(hhs.indexOf(jordan), 1);
      hhs.unshift(jordan);
    }
    let n = 0;
    let unicode = 0;
    for (const hh of hhs) {
      const hr = rng(`res:${hh.id}`);
      const last = hh.last;
      const size = hh.company ? 1 : hr.weighted([[1, 52], [2, 38], [3, 10]] as const);
      const current = hh.leases.some((l) => ["Active", "Notice", "Month-to-month", "Eviction"].includes(l.status));
      const future = hh.leases.every((l) => l.status === "Future");
      for (let i = 0; i < size; i++) {
        const id = `res-${p.id}-${String(++n).padStart(4, "0")}`;
        let first = hr.pick(FIRST);
        let lastName = i === 0 || hr.chance(0.6) ? last : hr.pick(LAST);
        if (hh === jordan && i === 0) [first, lastName] = ["Jordan", "Lee"];
        else if (!hh.company && hr.chance(0.012) && unicode < UNICODE_NAMES.length) [first, lastName] = UNICODE_NAMES[(unicode++ + p.id.charCodeAt(2)) % UNICODE_NAMES.length];
        const contact = hh.company ? { first: hr.pick(FIRST), last: hr.pick(LAST) } : null;
        const fn = contact?.first ?? first, ln = contact?.last ?? lastName;
        const row = add("residents", {
          id, household_id: hh.id, property_id: p.id, first_name: fn, last_name: ln,
          email: `${fn}.${ln}`.toLowerCase().normalize("NFD").replace(/[^a-z.]/g, "") + (hr.int(1, 99)) + "@mail.example",
          phone: `(${p.metro === "Atlanta" ? 404 : p.metro === "Phoenix" ? 480 : p.metro === "Dallas" ? 469 : 737}) 555-${String(hr.int(1000, 9999))}`,
          preferred_channel: hr.weighted([["Email", 45], ["SMS", 35], ["Portal", 15], ["Phone", 5]] as const), language: !hh.company && hr.chance(0.11) ? "es" : "en",
          is_primary: i === 0 ? 1 : 0, status: future ? "Future" : current ? (hh.leases.some((l) => l.status === "Notice") ? "Notice" : "Current") : "Past",
          autopay: hh.profile === "autopay" ? 1 : 0, risk_score: null,
        });
        hh.residents.push(row);
      }
      if (hh.residents.length > 1 && hr.chance(0.18)) hh.split = true;
      if (hh.company) hh.name = hh.company;
      else if (hh.residents.length) hh.name = `${hh.residents[0].last_name} household`;
      add("households", { id: hh.id, property_id: p.id, name: hh.name });
    }
  }
  const live = (h: Household) => h.leases.some((l) => ["Active", "Notice", "Month-to-month"].includes(l.status) && l.start < ASOF - 200);
  // Sad cases that change payment behaviour: one eviction (Marcus's Barton Creek), three payment plans.
  const evict = c.households.find((h) => h.p.id === "p02" && h.profile === "chronic" && live(h)) ?? c.households.find((h) => h.p.id === "p02" && live(h) && h.residents[0]?.id !== "res-p02-0001")!;
  evict.profile = "chronic";
  evict.evict = true;
  for (const pid of ["p01", "p03", "p09"]) {
    const h = c.households.find((x) => x.p.id === pid && x.profile === "chronic" && live(x) && !x.evict) ?? c.households.find((x) => x.p.id === pid && x.profile === "late" && live(x));
    if (h) {
      h.profile = "chronic";
      h.plan = true;
    }
  }
  const jordan = c.households.find((h) => h.residents[0]?.id === "res-p01-0001")!;
  jordan.profile = "ontime";

  // Parking and storage: items per property, assigned to current households.
  for (const p of c.props) {
    if (p.kind === "com") continue;
    const pr = rng(`parking:${p.id}`);
    const resUnits = p.units.filter((u) => !u.commercial).length;
    const garage = p.type.includes("rise") || p.type === "Mixed-use";
    const items: [string, string, string, number][] = [];
    for (let i = 0; i < Math.round(resUnits * (garage ? 0.3 : 0.12)); i++) {
      const sub = garage ? (i % 10 === 0 ? "EV" : "Garage") : "Covered";
      items.push([`P-${100 + i + 1}`, "Parking", sub, sub === "EV" ? 15_000 : sub === "Garage" ? 12_500 : 5_000]);
    }
    for (let i = 0; i < Math.round(resUnits * 0.05); i++) items.push([`S-${i + 1}`, "Storage", pr.pick(["5x5", "5x10", "10x10"]), pr.pick([4_500, 6_500, 9_500])]);
    const current = c.households.filter((h) => h.p === p && h.leases.some((l) => ["Active", "Notice", "Month-to-month", "Eviction"].includes(l.status)));
    for (const [label, kind, subtype, rent] of items) {
      const id = `ri-${p.id}-${label.toLowerCase()}`;
      add("rentable_items", { id, property_id: p.id, kind, label, subtype, rent_cents: rent });
      if (!current.length || !pr.chance(kind === "Parking" ? 0.72 : 0.6)) continue;
      const h = current[pr.int(0, current.length - 1)];
      if (h.parking) continue;
      h.parking = { item: label, rent };
      const first = h.leases[0];
      add("rentable_assignments", { id: `ras-${id}`, item_id: id, lease_id: h.leases.at(-1)!.id, property_id: p.id, start_on: iso(Math.max(first.start, WIN)), end_on: null, rent_cents: rent });
    }
  }

  for (const l of c.households.flatMap((h) => h.leases)) {
    c.leases.push(l);
    c.leaseById[l.id] = l;
  }
  for (const l of c.leases) {
    if (l.hh.evict && ["Active", "Month-to-month"].includes(l.status)) l.status = "Eviction";
    const sr = rng(`lease:${l.id}`);
    const signer = l.commercial ? "rachel" : l.u.p.agent;
    l.row = add("leases", {
      id: l.id, property_id: l.u.p.id, unit_id: l.u.id, household_id: l.hh.id, application_id: null, renewal_of: l.renewalOf && c.leaseById[l.renewalOf.id] ? l.renewalOf.id : null,
      kind: l.commercial ? "Commercial" : "Residential", status: l.status, start_on: iso(l.start), end_on: l.end === null ? null : iso(l.end),
      move_in_on: l.renewalOf ? null : iso(l.start), move_out_on: l.moveOut ? iso(l.moveOut) : null, notice_on: l.notice ? iso(l.notice) : null, term_months: l.term,
      rent_cents: l.rent, deposit_cents: l.deposit, escalations: l.commercial ? JSON.stringify(Array.from({ length: Math.floor((l.term ?? 12) / 12) - 0 }, (_, i) => ({ on: iso(addMonthsDay(l.start, 12 * (i + 1))), pct: 3 })).filter((e) => e.on <= iso(l.end ?? l.start))) : "[]",
      nnn_share_pct: l.commercial ? Math.round((l.u.sqft / l.u.p.units.reduce((s, u) => s + u.sqft, 0)) * 10000) / 100 : null,
      cam_cents: l.commercial ? l.cam : null, tax_cents: l.commercial ? l.tax : null, insurance_cents: l.commercial ? l.ins : null,
      signed_by: l.status === "Future" && sr.chance(0.4) ? null : signer, signed_at: l.status === "Future" && sr.chance(0.4) ? null : ts(l.start - sr.int(8, 40), sr.int(600, 1000)), document_id: null,
    });
    for (const r of l.hh.residents) if (l.hh.evict) r.status = "Eviction";
  }
  // Recurring charges describe what bills each month (the ledger posts them).
  for (const l of c.leases) {
    if (!["Active", "Notice", "Month-to-month", "Eviction", "Future"].includes(l.status)) continue;
    const lines: [string, string, number][] = l.commercial
      ? [["4010", "Base rent", suiteRentAt(l, ASOF)], ["4400", "CAM estimate", l.cam], ["4410", "Real estate tax estimate", l.tax], ["4420", "Insurance estimate", l.ins]]
      : [["4000", "Rent", l.rent], ...(l.hh.pet ? [["4310", "Pet rent", l.hh.pet] as [string, string, number]] : []), ...(l.hh.parking ? [["4300", `Parking ${l.hh.parking.item}`, l.hh.parking.rent] as [string, string, number]] : []), ...(l.hh.rubs ? [["4200", "RUBS water/sewer (estimate)", l.hh.rubs] as [string, string, number]] : [])];
    lines.forEach(([g, label, amount], i) => add("recurring_charges", { id: `rc-${l.id}-${i + 1}`, lease_id: l.id, property_id: l.u.p.id, gl_account_id: gl(g), label, amount_cents: amount, frequency: "Monthly", start_on: iso(l.start), end_on: l.end === null ? null : iso(l.end) }));
  }
}

// ---------------------------------------------------------------------------------------------
// Ledger: charges, payments, credits, deposits, transfers, journal entries
// ---------------------------------------------------------------------------------------------

const METHOD: [string, number][] = [["ACH", 58], ["Card", 16], ["Check", 17], ["Money order", 8], ["Cash", 1]];

function ledger(c: Ctx) {
  const { add, je } = c;
  const batches = new Map<string, R>();
  const batchFor = (p: Prop, d: number) => {
    const key = `${p.id}|${d}`;
    let b = batches.get(key);
    if (!b) {
      b = { id: `tr-b-${p.id}-${iso(d).replace(/-/g, "")}`, key: `batch:${p.id}:${iso(d)}`, kind: "Rent", bank_account_id: p.trust, owner_entity_id: p.entity, from_kind: "batch", from_id: p.id, from_name: `Deposit batch · ${p.name}`, to_kind: "trust", to_id: p.trust, to_name: "Operating trust", amount_cents: 0, property_id: p.id, ref: `Deposit ${iso(d)}`, status: "Cleared", created: ts(d, 17 * 60), settles_at: null, cleared: ts(d + 1, 10 * 60) };
      batches.set(key, b);
    }
    return b;
  };
  const charge = (l: Lease, glNo: string, description: string, period: string, due: number, amount: number): Open | null => {
    if (amount <= 0 || due >= ASOF + 1) return null;
    const id = `ch-${String(c.next("charge")).padStart(6, "0")}`;
    add("charges", { id, lease_id: l.id, household_id: l.hh.id, property_id: l.u.p.id, unit_id: l.u.id, gl_account_id: gl(glNo), description, period, due_on: iso(due), amount_cents: amount });
    je(l.u.p.id, "1200", period, amount, 0);
    je(l.u.p.id, glNo, period, 0, amount);
    const o: Open = { id, rem: amount, due, lease: l, gl: glNo, amount };
    l.hh.open.push(o);
    return o;
  };
  const credit = (l: Lease, o: Open | null, kind: "Concession" | "Credit" | "Write-off", description: string, d: number, amount: number, debitGl: string, by: string | null) => {
    if (amount <= 0) return;
    add("credits", { id: `cr-${String(c.next("credit")).padStart(6, "0")}`, lease_id: l.id, property_id: l.u.p.id, charge_id: o?.id ?? null, kind, description, on_date: iso(d), amount_cents: amount, approved_by: by });
    je(l.u.p.id, debitGl, ym(d), amount, 0);
    je(l.u.p.id, "1200", ym(d), 0, amount);
    if (o) o.rem -= amount;
  };
  // Applies a payment oldest-charge-first; an NSF payment records rows but moves nothing.
  const pay = (hh: Household, amount: number, d: number, method: string, nsf = false) => {
    if (d >= ASOF || amount <= 0) return 0;
    const p = hh.p;
    const ref = method === "Check" ? `Check #${rng(`chk:${hh.id}:${d}`).int(1001, 4999)}` : method === "ACH" ? `ACH ${hash32(`${hh.id}${d}`).toString().slice(0, 8)}` : method === "Card" ? `Card ••${rng(`card:${hh.id}`).int(1000, 9999)}` : method === "Money order" ? `MO ${hash32(`mo${hh.id}${d}`).toString().slice(0, 9)}` : "Cash receipt";
    let left = amount;
    const rows: R[] = [];
    for (const o of hh.open) {
      if (left <= 0) break;
      if (o.rem <= 0) continue;
      const a = Math.min(o.rem, left);
      rows.push({ id: "", lease_id: o.lease.id, household_id: hh.id, property_id: p.id, charge_id: o.id, transfer_id: null, method, reference: ref, received_on: iso(d), amount_cents: a, nsf: nsf ? 1 : 0 });
      if (!nsf) o.rem -= a;
      left -= a;
    }
    if (left > 0) rows.push({ id: "", lease_id: hh.leases.findLast((l) => l.start <= d)?.id ?? hh.leases[0].id, household_id: hh.id, property_id: p.id, charge_id: null, transfer_id: null, method, reference: ref, received_on: iso(d), amount_cents: left, nsf: nsf ? 1 : 0 });
    let tr: R;
    if (nsf) {
      tr = { id: `tr-nsf-${hash32(hh.id + d).toString(36)}`, key: `nsf:${hh.id}:${iso(d)}`, kind: "Rent", bank_account_id: p.trust, owner_entity_id: p.entity, from_kind: "resident", from_id: hh.residents[0]?.id ?? hh.id, from_name: hh.name, to_kind: "trust", to_id: p.trust, to_name: "Operating trust", amount_cents: amount, property_id: p.id, ref: `${ref} (returned NSF)`, status: "Returned", created: ts(d, 15 * 60), settles_at: null, cleared: null };
      add("transfers", tr);
    } else {
      tr = batchFor(p, d);
      tr.amount_cents = (tr.amount_cents as number) + amount;
      je(p.id, "1010", ym(d), amount, 0);
      je(p.id, "1200", ym(d), 0, amount);
    }
    for (const row of rows) {
      row.id = `pay-${String(c.next("payment")).padStart(6, "0")}`;
      row.transfer_id = tr.id;
      add("payments", row);
    }
    return amount;
  };

  for (const hh of c.households) {
    const hr = rng(`pay:${hh.id}`);
    const p = hh.p;
    const leases = hh.leases.filter((l) => l.status !== "Future");
    if (!leases.length) continue;
    // Deposit for the whole chain, received at the first move-in.
    const first = leases[0];
    const chainEnd = leases.at(-1)!;
    const deposit = chainEnd.deposit;
    let depositRow: R | null = null;
    if (deposit > 0 && (chainEnd.moveOut ?? Infinity) >= WIN) {
      const d = first.start - 3;
      const tid = `tr-dep-${first.id}`;
      add("transfers", { id: tid, key: `deposit:${first.id}`, kind: "Deposit", bank_account_id: p.dep, owner_entity_id: p.entity, from_kind: "resident", from_id: hh.id, from_name: hh.name, to_kind: "deposit", to_id: p.dep, to_name: "Security deposit account", amount_cents: deposit, property_id: p.id, ref: `Security deposit ${first.id}`, status: "Cleared", created: ts(d, 14 * 60), settles_at: null, cleared: ts(d + 1, 10 * 60) });
      je(p.id, "1020", ym(d), deposit, 0);
      je(p.id, "2100", ym(d), 0, deposit);
      depositRow = add("deposits", { id: `dep-${first.id}`, lease_id: chainEnd.id, property_id: p.id, bank_account_id: p.dep, amount_cents: deposit, received_on: iso(d), status: "Held" });
    }
    // Winter move-ins at B/C properties get a concession spread over the term.
    for (const l of leases) {
      const m = Number(iso(l.start).slice(5, 7));
      if (!l.commercial && !l.renewalOf && l.start >= WIN && [11, 12, 1, 2].includes(m) && (p.cls !== "A" || p.id === "p11" || hr.chance(0.25)) && hr.chance(0.55)) {
        const six = hr.chance(0.5);
        const total = six ? round(l.rent * 1.5, 100) : 50_000;
        const months = six ? Array.from({ length: Math.min(12, l.term ?? 12) }, (_, i) => addMonths(ym(l.start), i + 1)) : [ym(l.start)];
        l.concession = { label: six ? "6 weeks free, spread over the lease" : "$500 off the first month", monthly: Math.floor(total / months.length), months };
      }
    }
    for (const period of PERIODS) {
      const ms = monthStart(period), me = monthEnd(period);
      const due: Open[] = [];
      for (const l of leases) {
        // A current lease with no notice holds over past its end date (renewal or month-to-month pending).
        const endDay = l.moveOut ?? (l.mtm || l.status === "Active" || l.status === "Eviction" ? Infinity : l.end ?? Infinity);
        const s = Math.max(l.start, ms), e = Math.min(endDay, me);
        if (s > e || s > ASOF) continue;
        const days = e - s + 1;
        const dim = daysInMonth(period);
        const prorate = (amt: number) => (days === dim ? amt : Math.round((amt * days) / dim));
        const dueDay = s;
        const label = days === dim ? "" : ` (prorated ${days}/${dim} days)`;
        if (l.commercial) {
          const base = suiteRentAt(l, s);
          for (const [g, amt, d] of [["4010", base, "Base rent"], ["4400", l.cam, "CAM estimate"], ["4410", l.tax, "Real estate tax estimate"], ["4420", l.ins, "Insurance estimate"]] as const) {
            const o = charge(l, g, `${d} ${period}${label}`, period, dueDay, prorate(amt));
            if (o) due.push(o);
          }
          if (period === "2026-01" && l.start < day("2025-01-01")) {
            const delta = Math.round(l.cam * 12 * (hr() * 0.2 - 0.08));
            if (delta > 0) {
              const o = charge(l, "4400", "2025 CAM reconciliation (true-up)", period, ms + 14, delta);
              if (o) due.push(o);
            } else credit(l, null, "Credit", "2025 CAM reconciliation (credit)", ms + 14, -delta, "4400", "grace");
          }
          continue;
        }
        const rentAmt = l.mtm && l.end !== null && s > l.end ? l.rent + 10_000 : l.rent;
        const o = charge(l, "4000", `Rent ${period}${label}${l.mtm && l.end !== null && s > l.end ? " · month-to-month" : ""}`, period, dueDay, prorate(rentAmt));
        if (o) {
          due.push(o);
          if (l.concession?.months.includes(period)) credit(l, o, "Concession", l.concession.label, dueDay, Math.min(o.rem, l.concession.monthly), "4900", p.region === "r-tx" ? "priya" : p.region === "r-se" ? "s-wanjiru" : "s-colton");
        }
        if (hh.pet) { const x = charge(l, "4310", `Pet rent ${period}`, period, dueDay, prorate(hh.pet)); if (x) due.push(x); }
        if (hh.parking) { const x = charge(l, "4300", `Parking ${hh.parking.item} ${period}`, period, dueDay, prorate(hh.parking.rent)); if (x) due.push(x); }
        if (hh.rubs) {
          const season = p.metro === "Phoenix" ? [1, 1, 1, 1.05, 1.15, 1.3, 1.35, 1.3, 1.15, 1.05, 1, 1] : [1, 1, 1, 1, 1.05, 1.12, 1.18, 1.15, 1.05, 1, 1, 1];
          const amt = round(hh.rubs * season[Number(period.slice(5)) - 1], 1);
          const x = charge(l, "4200", `Utility reimbursement (RUBS water/sewer) ${period}`, period, dueDay + 4 > me ? dueDay : dueDay, prorate(amt));
          if (x) due.push(x);
        }
      }
      if (!due.length) continue;
      const total = due.reduce((s, o) => s + o.rem, 0);
      const dueDay = Math.min(...due.map((o) => o.due));
      const isJordanNov = hh.residents[0]?.id === "res-p01-0001" && period === CURRENT_PERIOD;
      const method = hh.profile === "autopay" ? "ACH" : hr.weighted(METHOD);
      let payDay: number;
      let amount = total;
      if (hh.profile === "autopay") payDay = dueDay;
      else if (hh.profile === "ontime") payDay = dueDay + hr.int(0, 2);
      else if (hh.profile === "late") payDay = hr.chance(0.45) ? dueDay + hr.int(0, 2) : dueDay + hr.int(4, 16);
      else {
        payDay = dueDay + hr.int(4, 21);
        amount = hr.chance(0.18) ? 0 : round(total * (0.45 + hr() * 0.45), 100);
        if (hh.plan && period >= "2026-08") amount = total + round(total * 0.25, 100);
      }
      if (isJordanNov || hh.evict && period >= "2026-08") amount = hh.evict && period === "2026-08" ? round(total * 0.3, 100) : 0;
      // Late fee once rent is still unpaid after the grace period (Nov is left to the demo action).
      const lateDay = dueDay + p.graceDays + 1;
      const rentOpen = due.find((o) => o.gl === "4000" || o.gl === "4010");
      if (rentOpen && period < CURRENT_PERIOD && lateDay < ASOF && (amount < total || payDay >= lateDay) && hh.profile !== "autopay") {
        const fee = lateFee(p, rentOpen.amount, Math.max(0, Math.min(payDay, ASOF) - lateDay));
        const lease = rentOpen.lease;
        const o = charge(lease, "4100", `Late fee ${period}`, period, lateDay, fee);
        if (o) {
          if (hr.chance(0.06)) credit(lease, o, "Credit", "Late fee waived (first occurrence)", lateDay + 2, fee, "4100", p.manager);
          else if (amount >= total) amount += fee;
        }
      }
      // NSF: the payment bounces, a fee is charged and the household pays again by money order.
      if (amount > 0 && (method === "Check" || method === "ACH") && hh.profile !== "autopay" && hr.chance(0.006) && payDay + 6 < ASOF) {
        pay(hh, amount, payDay, method, true);
        const nsfFee = charge(rentOpen?.lease ?? due[0].lease, "4110", `Returned payment (NSF) fee ${period}`, period, payDay + 1, 3500);
        payDay += 6;
        if (nsfFee) amount += 3500;
        pay(hh, amount, payDay, "Money order");
        continue;
      }
      if (amount > 0 && hh.split) {
        const half = Math.floor(amount / 2);
        pay(hh, half, payDay, method);
        pay(hh, amount - half, payDay + hr.int(0, 3), hr.pick(["ACH", "Card"]));
      } else pay(hh, amount, payDay, method);
      // Chronic payers sometimes catch up on part of the arrears.
      if (hh.profile === "chronic" && !hh.evict && hr.chance(0.3)) {
        const arrears = hh.open.reduce((s, o) => s + Math.max(0, o.rem), 0);
        pay(hh, round(arrears * 0.6, 100), payDay + hr.int(5, 12), "Money order");
      }
      // A prepaid credit on account for a few tidy households.
      if (period === "2026-10" && hh.profile === "autopay" && hr.chance(0.02)) pay(hh, round(total, 100), monthStart(period) + 24, "ACH");
    }

    // Move-out: deposit disposition (state deadline), deductions, write-off of what's left.
    const last = leases.at(-1)!;
    if (last.moveOut && last.moveOut < ASOF && last.moveOut >= WIN && depositRow) {
      const mo = last.moveOut;
      const dr = rng(`dispo:${last.id}`);
      const days = p.state === "AZ" ? 20 : 30;
      const damages = dr.chance(0.32) ? round(15_000 + dr() * 75_000, 500) : 0;
      if (damages) {
        charge(last, "6050", "Move-out damages and cleaning", ym(mo), mo + 2, damages);
      }
      const sent = mo + dr.int(6, days + (dr.chance(0.08) ? 12 : -2));
      const balance = hh.open.reduce((s, o) => s + Math.max(0, o.rem), 0);
      const applied = Math.min(balance, deposit);
      const refund = deposit - applied;
      const deductions: { label: string; amount_cents: number; photo: string | null }[] = [];
      if (sent < ASOF) {
        let left = applied;
        for (const o of hh.open) {
          if (left <= 0) break;
          const a = Math.min(Math.max(0, o.rem), left);
          if (!a) continue;
          credit(o.lease, o, "Credit", "Security deposit applied", sent, a, "2100", "grace");
          deductions.push({ label: o.gl === "6050" ? "Damages and cleaning" : o.gl === "4000" ? "Unpaid rent" : "Unpaid charges", amount_cents: a, photo: o.gl === "6050" ? `/img/wo/wo-${dr.pick(["carpet", "door", "window", "mold"])}.webp` : null });
          left -= a;
        }
        if (applied) {
          add("transfers", { id: `tr-depapp-${last.id}`, key: `depapply:${last.id}`, kind: "Deposit refund", bank_account_id: p.dep, owner_entity_id: p.entity, from_kind: "deposit", from_id: p.dep, from_name: "Security deposit account", to_kind: "trust", to_id: p.trust, to_name: "Operating trust", amount_cents: applied, property_id: p.id, ref: `Deposit applied ${last.id}`, status: "Cleared", created: ts(sent, 11 * 60), settles_at: null, cleared: ts(sent + 1, 10 * 60) });
          add("transfers", { id: `tr-deprcv-${last.id}`, key: `depreceipt:${last.id}`, kind: "Other receipt", bank_account_id: p.trust, owner_entity_id: p.entity, from_kind: "deposit", from_id: p.dep, from_name: "Security deposit account", to_kind: "trust", to_id: p.trust, to_name: "Operating trust", amount_cents: applied, property_id: p.id, ref: `Deposit applied ${last.id}`, status: "Cleared", created: ts(sent, 11 * 60 + 1), settles_at: null, cleared: ts(sent + 1, 10 * 60) });
          je(p.id, "1010", ym(sent), applied, 0);
          je(p.id, "1020", ym(sent), 0, applied);
        }
        if (refund) {
          add("transfers", { id: `tr-refund-${last.id}`, key: `refund:${last.id}`, kind: "Deposit refund", bank_account_id: p.dep, owner_entity_id: p.entity, from_kind: "deposit", from_id: p.dep, from_name: "Security deposit account", to_kind: "resident", to_id: hh.id, to_name: hh.name, amount_cents: refund, property_id: p.id, ref: `Deposit refund ${last.id}`, status: "Cleared", created: ts(sent, 11 * 60 + 2), settles_at: null, cleared: ts(sent + 2, 10 * 60) });
          je(p.id, "2100", ym(sent), refund, 0);
          je(p.id, "1020", ym(sent), 0, refund);
        }
        depositRow.status = "Settled";
        // Balance beyond the deposit is written off 60 days later.
        const owed = hh.open.reduce((s, o) => s + Math.max(0, o.rem), 0);
        if (owed > 0 && sent + 60 < ASOF) for (const o of hh.open) if (o.rem > 0) credit(o.lease, o, "Write-off", "Uncollectible balance after move-out (sent to collections)", sent + 60, o.rem, "6900", "grace");
      } else depositRow.status = "Disposition due";
      add("deposit_dispositions", { id: `dd-${last.id}`, deposit_id: depositRow.id, property_id: p.id, deductions: JSON.stringify(deductions), refund_cents: sent < ASOF ? refund : deposit - applied, due_on: iso(mo + days), sent_on: sent < ASOF ? iso(sent) : null, status: sent < ASOF ? (dr.chance(0.04) ? "Disputed" : "Sent") : "Draft" });
    }
  }
  for (const b of batches.values()) add("transfers", b);
  c.transfers = c.t.transfers;
}

export function lateFee(p: Prop, rent: number, daysLate: number) {
  if (p.state === "TX") return Math.min(pctOf(rent, 10), pctOf(rent, p.units.length <= 4 || p.id === "p07" ? 12 : 10));
  if (p.state === "GA") return 7500;
  return Math.min(5000 + 1000 * daysLate, 15000);
}

// ---------------------------------------------------------------------------------------------
// Operations that cost money: work orders, recurring bills, utilities, turnovers, capex.
// Every bill posts Dr expense / Cr AP; payment posts Dr AP / Cr trust with a vendor payout.
// ---------------------------------------------------------------------------------------------

export const WO_TYPES: [category: string, title: string, trade: string, minCost: number, maxCost: number, photo: string | null][] = [
  ["Plumbing", "Kitchen sink leaking under cabinet", "Plumbing", 18_000, 65_000, "leak"],
  ["Plumbing", "Toilet running constantly", "Plumbing", 12_000, 32_000, "toilet"],
  ["Plumbing", "Garbage disposal jammed", "Plumbing", 9_500, 28_000, "disposal"],
  ["Plumbing", "No hot water", "Plumbing", 25_000, 160_000, "water-heater"],
  ["Plumbing", "Ceiling stain from unit above", "Plumbing", 30_000, 120_000, "leak"],
  ["HVAC", "AC not cooling", "HVAC", 22_000, 145_000, "hvac"],
  ["HVAC", "Heater blowing cold air", "HVAC", 18_000, 90_000, "hvac"],
  ["HVAC", "Thermostat unresponsive", "HVAC", 9_000, 26_000, "hvac"],
  ["Electrical", "Outlets not working in bedroom", "Electrical", 12_000, 48_000, "electrical"],
  ["Electrical", "Breaker keeps tripping", "Electrical", 15_000, 60_000, "electrical"],
  ["Appliance", "Refrigerator not cooling", "Appliance", 16_000, 110_000, "appliance"],
  ["Appliance", "Dishwasher not draining", "Appliance", 11_000, 42_000, "appliance"],
  ["Appliance", "Washer leaking", "Appliance", 12_000, 55_000, "appliance"],
  ["General", "Front door lock sticking", "Locksmith", 8_500, 26_000, "door"],
  ["General", "Window won't latch", "General", 9_000, 34_000, "window"],
  ["General", "Mold spotting in bathroom", "General", 25_000, 180_000, "mold"],
  ["General", "Carpet stain and tear", "Flooring", 15_000, 85_000, "carpet"],
  ["General", "Pest sighting (roaches)", "Pest control", 8_500, 22_000, null],
];
export const COMMON_WO: [string, string, string, number, number, string | null][] = [
  ["Grounds", "Fence panel down near dog park", "General", 30_000, 140_000, "fence"],
  ["Grounds", "Parking lot pothole", "General", 45_000, 260_000, "parking"],
  ["Access", "Vehicle gate not closing", "General", 35_000, 180_000, "gate"],
  ["Roofing", "Roof leak over breezeway", "Roofing", 60_000, 420_000, "roof"],
  ["Pool", "Pool pump making noise", "Pool", 28_000, 150_000, "pool-pump"],
  ["Electrical", "Parking lot lights out", "Electrical", 22_000, 95_000, "electrical"],
  ["General", "Trash compactor jammed", "General", 18_000, 75_000, null],
];
// Plausible wrong account for each expense account (all expense-to-expense, so NOI is unchanged).
const MISCODE: Record<string, string> = { "6000": "6100", "6100": "6000", "6150": "6600", "6230": "6150", "6400": "6500", "6500": "6400", "6600": "6150", "6700": "6000" };
const PRIORITY: [string, number][] = [["Emergency", 5], ["Urgent", 18], ["Normal", 62], ["Low", 15]];
const SLA_HOURS: Record<string, number> = { Emergency: 4, Urgent: 24, Normal: 72, Low: 168 };

function operations(c: Ctx) {
  const { add, je } = c;
  const billIds = { n: 0 };
  // Creates a bill and, when its due date has passed, pays it from trust.
  const bill = (p: Prop, vendor: string, lines: [glNo: string, description: string, amount: number][], billDate: number, opts: { wo?: string; recurring?: string; po?: string; termsDays?: number; status?: string; doc?: string } = {}) => {
    const amount = lines.reduce((s, l) => s + l[2], 0);
    if (amount <= 0 || billDate >= ASOF) return null;
    const id = `BILL-${String(++billIds.n + 20000)}`;
    const due = billDate + (opts.termsDays ?? 30);
    const br = rng(`bill:${id}`);
    const paidOn = Math.min(due - br.int(0, 6), due);
    const paid = paidOn < ASOF - 1 && (ASOF - billDate > 21 || opts.termsDays === 10);
    const status = paid ? "Paid" : opts.status ?? (ASOF - billDate < 6 ? br.weighted([["Pending approval", 55], ["Draft", 20], ["Approved", 25]] as const) : br.weighted([["Approved", 50], ["Scheduled", 25], ["Pending approval", 25]] as const));
    const row = add("bills", {
      id, property_id: p.id, owner_entity_id: p.entity, vendor_id: vendor, work_order_id: opts.wo ?? null, po_id: opts.po ?? null, recurring_bill_id: opts.recurring ?? null, document_id: opts.doc ?? null,
      invoice_number: `${c.vendorName[vendor].replace(/[^A-Z]/g, "").slice(0, 3) || "INV"}-${br.int(10000, 99999)}`, bill_date: iso(billDate), due_on: iso(due), amount_cents: amount, status,
      approved_by: status === "Paid" || status === "Approved" || status === "Scheduled" ? (amount > 500_000 ? "grace" : "s-lucy") : null, approved_at: status === "Paid" || status === "Approved" || status === "Scheduled" ? ts(billDate + 2, 600 + br.int(0, 300)) : null,
    });
    c.bills.push(row);
    // Corrupted case: about 5.5% of contract and work-order bills are coded to the wrong GL account.
    // The journal posts what was coded, so the books still agree; Data Health finds the mismatch.
    const miscode = (opts.recurring || opts.wo) && rng(`miscode:${id}`).chance(0.055) ? MISCODE[lines[0][0]] : undefined;
    for (const [g0, d, a] of lines) {
      const g = miscode && g0 === lines[0][0] ? miscode : g0;
      const lineId = `bl-${String(c.next("bill_line")).padStart(6, "0")}`;
      add("bill_lines", { id: lineId, bill_id: id, gl_account_id: gl(g), description: d, qty: 1, unit_cents: a, amount_cents: a });
      if (g !== g0) (c.planted["bill_lines.gl_miscoded"] ??= []).push(`${lineId}|${g0}`);
      je(p.id, g, ym(billDate), a, 0);
    }
    je(p.id, "2000", ym(billDate), 0, amount);
    if (paid) {
      add("transfers", { id: `tr-v-${id}`, key: `vendor:${id}`, kind: "Vendor payout", bank_account_id: p.trust, owner_entity_id: p.entity, from_kind: "trust", from_id: p.trust, from_name: "Operating trust", to_kind: "vendor", to_id: vendor, to_name: c.vendorName[vendor], amount_cents: amount, property_id: p.id, ref: id, status: "Cleared", created: ts(paidOn, 13 * 60), settles_at: null, cleared: ts(paidOn + 1, 10 * 60) });
      je(p.id, "2000", ym(paidOn), amount, 0);
      je(p.id, "1010", ym(paidOn), 0, amount);
    }
    return row;
  };
  c.bill = bill;

  for (const p of c.props) {
    const pr = rng(`ops:${p.id}`);
    const resUnits = p.units.filter((u) => !u.commercial).length;
    const size = p.units.length;
    const sqft = p.units.reduce((s, u) => s + u.sqft, 0);
    const recurring: [string, string, string, number][] = [];
    if (p.kind !== "com" || p.type === "Retail strip") recurring.push([p.vendors.Landscaping, "6100", "Landscaping contract", round(80_000 + size * 1_400 * (0.9 + pr() * 0.2), 500)]);
    else recurring.push([p.vendors.Landscaping, "6100", "Grounds maintenance", round(60_000 + sqft * 0.6, 500)]);
    recurring.push([p.vendors.Trash, "6230", "Trash and recycling service", round(35_000 + size * 1_150, 500)]);
    recurring.push(["v21", "6150", "Pest control service", round(18_000 + size * 260, 500)]);
    if (p.stories >= 4) recurring.push(["v22", "6150", "Elevator maintenance contract", round(55_000 + p.stories * 4_000, 500)]);
    if (p.pool) recurring.push([p.vendors.Pool === "v42" ? "v20" : p.vendors.Pool, "6150", "Pool service", round(42_000 + pr.int(0, 30) * 1_000, 500)]);
    if (p.kind !== "com") recurring.push(["v40", "6600", "Listing syndication and ads", round(25_000 + resUnits * 450, 500)]);
    if (p.kind !== "com") recurring.push(["v43", "6700", "On-site payroll reimbursement", round(resUnits * 19_500 * (p.cls === "A" ? 1.1 : 1), 500)]);
    else recurring.push(["v43", "6700", "Building engineer and day porter", round(sqft * 9, 500)]);
    recurring.push(["v44", "6000", "Maintenance supplies and parts", round(size * 1_400, 500)]);
    const taxYear = p.kind === "com" ? sqft * (p.state === "TX" ? 260 : 170) : resUnits * (p.state === "TX" ? 215_000 : p.state === "GA" ? 130_000 : 95_000);
    recurring.push(["v41", "6500", "Property tax escrow", round(taxYear / 12, 100)]);
    const premium = p.kind === "com" ? sqft * 45 : resUnits * 52_000;
    recurring.push(["v39", "6400", "Property and liability insurance installment", round(premium / 12, 100)]);
    recurring.forEach(([vendor, g, desc, amount], i) => {
      const rid = `rb-${p.id}-${i + 1}`;
      const dom = [1, 5, 10, 15, 20][i % 5];
      add("recurring_bills", { id: rid, property_id: p.id, vendor_id: vendor, gl_account_id: gl(g), description: desc, amount_cents: amount, frequency: "Monthly", day_of_month: dom, next_on: iso(monthStart(CURRENT_PERIOD) + dom - 1 > ASOF ? monthStart(CURRENT_PERIOD) + dom - 1 : monthStart("2026-12") + dom - 1), active: 1 });
      for (const period of PERIODS) bill(p, vendor, [[g, `${desc} · ${period}`, amount]], monthStart(period) + dom - 1, { recurring: rid, termsDays: g === "6500" || g === "6400" ? 10 : 30 });
    });
    if (p.kind !== "com" || p.type === "Retail strip") {
      // Insurance policies (the bills above pay them).
      add("insurance_policies", { id: `ins-${p.id}-prop`, property_id: p.id, kind: "Property", carrier: "Sentinel Property Insurance Co.", policy_number: `SPI-${pr.int(100000, 999999)}`, coverage_cents: round(sqft * 21_000, 100_000), premium_cents: round(premium * 0.78, 100), starts_on: "2026-03-01", expires_on: "2027-02-28" });
    } else add("insurance_policies", { id: `ins-${p.id}-prop`, property_id: p.id, kind: "Property", carrier: "Keystone Specialty", policy_number: `KS-${pr.int(100000, 999999)}`, coverage_cents: round(sqft * 26_000, 100_000), premium_cents: round(premium * 0.8, 100), starts_on: "2026-07-01", expires_on: "2027-06-30" });
    add("insurance_policies", { id: `ins-${p.id}-gl`, property_id: p.id, kind: "General liability", carrier: "Great Plains Mutual", policy_number: `GPM-${pr.int(100000, 999999)}`, coverage_cents: 200_000_000, premium_cents: round(premium * 0.22, 100), starts_on: "2026-03-01", expires_on: p.id === "p27" ? "2026-11-20" : "2027-02-28" });

    // Utilities: master meters with seasonal bills; RUBS recovers water/sewer from residents.
    const meters: [string, string, string, number][] = [["Water", p.vendors.Utilities, "6200", p.kind === "com" ? sqft * 0.9 : resUnits * 3_300], ["Electric", p.vendors.Electric, "6210", p.kind === "com" ? sqft * 1.4 : resUnits * 1_050]];
    if (p.metro === "Atlanta" && p.kind !== "com") meters.push(["Gas", "v37", "6220", resUnits * 900]);
    for (const [utility, vendor, g, baseAmt] of meters) {
      const mid = `mtr-${p.id}-${utility.toLowerCase()}`;
      add("utility_meters", { id: mid, property_id: p.id, unit_id: null, utility, meter_number: `${utility[0]}${pr.int(1000000, 9999999)}`, provider: c.vendorName[vendor] });
      let reading = pr.int(100000, 900000);
      for (const period of PERIODS) {
        const mo = Number(period.slice(5));
        const summer = [6, 7, 8, 9].includes(mo), winter = [12, 1, 2].includes(mo);
        const season = utility === "Electric" ? (summer ? (p.metro === "Phoenix" ? 1.75 : 1.4) : 1) : utility === "Gas" ? (winter ? 1.8 : 0.6) : summer ? (p.metro === "Phoenix" ? 1.35 : 1.15) : 1;
        const amount = round(baseAmt * season * (0.94 + pr() * 0.12), 1);
        const usage = Math.round(amount / (utility === "Electric" ? 14 : utility === "Gas" ? 120 : 1100) * 10) / 10;
        reading += Math.round(usage);
        const readOn = monthStart(period) + 26;
        if (readOn < ASOF) add("meter_readings", { id: `mr-${mid}-${period}`, meter_id: mid, property_id: p.id, read_on: iso(readOn), reading, usage });
        const b = bill(p, vendor, [[g, `${utility} service · ${period}`, amount]], monthStart(period) + 27, { termsDays: 20 });
        if (b) add("utility_bills", { id: `ub-${mid}-${period}`, property_id: p.id, meter_id: mid, bill_id: b.id as string, utility, period, usage, amount_cents: amount, rubs_method: utility === "Water" && p.rubs ? "Occupants" : null, recovered_cents: 0 });
      }
    }
  }

  // Work orders. Volume ~0.13 per occupied unit-month plus common-area jobs.
  let woN = c.woN;
  for (const p of c.props) {
    const pr = rng(`wo:${p.id}`);
    for (const period of PERIODS) {
      const ms = monthStart(period);
      const last = Math.min(monthEnd(period), ASOF);
      const occ = p.units.filter((u) => u.leases.some((l) => l.start <= last && (l.moveOut ?? Infinity) >= ms && l.status !== "Future"));
      const rate = p.kind === "com" ? 0.06 : 0.13;
      const n = Math.round(occ.length * rate * (period === CURRENT_PERIOD ? 4 / 30 : 1) * (0.85 + pr() * 0.3)) + (period === CURRENT_PERIOD ? 2 : 0);
      const common = Math.round((p.kind === "com" ? 1.5 : 3) * (period === CURRENT_PERIOD ? 0.6 : 1) * (0.7 + pr() * 0.6));
      for (let i = 0; i < n + common; i++) {
        const isCommon = i >= n;
        const u = isCommon ? null : occ[pr.int(0, occ.length - 1)];
        const spec = isCommon ? (pr.chance(0.4) && !p.pool ? COMMON_WO[pr.int(0, 3)] : COMMON_WO[pr.int(0, COMMON_WO.length - 1)]) : WO_TYPES[pr.int(0, WO_TYPES.length - 1)];
        const opened = ms + pr.int(0, Math.max(0, last - ms));
        if (opened > ASOF) continue;
        createWorkOrder(c, p, u, spec, opened, `WO-${++woN}`, pr, isCommon ? "Staff" : pr.chance(0.85) ? "Resident" : "Staff", null);
      }
    }
  }
  c.woN = woN;

  // Turnovers for move-outs in the window; make-ready cost billed by the turn vendor.
  for (const u of c.units) {
    for (const l of u.leases) {
      if (!l.moveOut || l.moveOut < WIN || l.moveOut > ASOF + 40 || u.commercial) continue;
      const tr = rng(`turn:${l.id}`);
      const target = l.moveOut + tr.int(6, 10);
      const took = tr.chance(0.1) ? tr.int(14, 30) : tr.int(4, 11);
      const ready = l.moveOut + took;
      const status = l.moveOut > ASOF ? "Not started" : ready > ASOF ? (ASOF - l.moveOut < 2 ? "Not started" : "In progress") : u.leases.some((x) => x.start > l.moveOut! && x.start <= ASOF) ? "Leased" : "Ready";
      const cost = round(42_000 + u.sqft * 55 + tr() * 60_000, 100);
      const id = `to-${l.id}`;
      const steps = ["Move-out inspection", "Trash-out", "Paint", "Clean", "Carpet / flooring", "Repairs", "Final walk"];
      const doneSteps = status === "Not started" ? 0 : status === "In progress" ? Math.min(steps.length - 1, Math.floor(((ASOF - l.moveOut) / took) * steps.length)) : steps.length;
      add("turnovers", { id, property_id: u.p.id, unit_id: u.id, lease_id: l.id, move_out_on: iso(l.moveOut), target_ready_on: iso(target), ready_on: ready <= ASOF ? iso(ready) : null, status, checklist: JSON.stringify(steps.map((s, i) => ({ step: s, done: i < doneSteps, by: i < doneSteps ? (i === 0 ? u.p.manager : c.vendorName[u.p.vendors.Turn]) : null }))), vendor_id: u.p.vendors.Turn, cost_cents: status === "Ready" || status === "Leased" ? cost : 0 });
      if (status === "Ready" || status === "Leased") bill(u.p, u.p.vendors.Turn, [["6050", `Make-ready unit ${u.number}: paint, clean, carpet`, cost]], ready + 1);
    }
  }
}

export function createWorkOrder(c: Ctx, p: Prop, u: Unit | null, spec: (typeof WO_TYPES)[number], opened: number, id: string, pr: Rng, source: string, extra: { pm?: string; turnover?: string; sr?: string; title?: string } | null) {
  const { add } = c;
  const priority = spec[0] === "HVAC" && [6, 7, 8].includes(Number(iso(opened).slice(5, 7))) && p.metro === "Phoenix" ? "Urgent" : spec[1].includes("No hot water") || spec[1].includes("Ceiling") ? pr.weighted([["Emergency", 30], ["Urgent", 70]] as const) : pr.weighted(PRIORITY);
  const openedMin = pr.int(7 * 60, 19 * 60);
  const hours = priority === "Emergency" ? pr.int(1, 5) : priority === "Urgent" ? pr.int(3, 28) : priority === "Normal" ? pr.int(6, 84) : pr.int(24, 190);
  const stuck = pr.chance(0.05);
  const doneDay = opened + Math.floor((openedMin / 60 + hours * (stuck ? 3 : 1)) / 24);
  const vendorJob = pr.chance(spec[2] === "Pest control" || spec[2] === "Roofing" || spec[2] === "Pool" ? 0.95 : 0.42);
  const vendor = vendorJob ? (p.vendors[spec[2]] ?? p.vendors.General) : null;
  const tech = p.techs.length ? p.techs[pr.int(0, p.techs.length - 1)] : null;
  const estimate = round(spec[3] + pr() * (spec[4] - spec[3]), 500);
  const cost = round(estimate * (0.82 + pr() * 0.36), 100);
  const sla = opened * 1440 + openedMin + SLA_HOURS[priority] * 60;
  const open = doneDay > ASOF || (doneDay === ASOF && pr.chance(0.5)) || source === "Preventive" && opened > ASOF - 3;
  let status = "Completed";
  if (open) {
    const age = ASOF - opened;
    status = age === 0 ? pr.weighted([["New", 55], ["Triaged", 30], ["Assigned", 15]] as const) : pr.weighted([["Assigned", 20], ["Scheduled", 30], ["In progress", 28], ["On hold", 10], ["Submitted", vendor ? 12 : 0]] as const);
  } else if (pr.chance(0.015)) status = "Cancelled";
  else if (vendor && doneDay + 30 < ASOF && !c.sealed) status = "Paid";
  const completedDay = status === "Completed" || status === "Paid" ? doneDay : null;
  const unitNo = u ? ` · #${u.number}` : "";
  const row = add("work_orders", {
    id, property_id: p.id, unit_id: u?.id ?? null, service_request_id: extra?.sr ?? null, pm_schedule_id: extra?.pm ?? null, turnover_id: extra?.turnover ?? null,
    title: extra?.title ?? spec[1], description: `${extra?.title ?? spec[1]}${unitNo}. ${u ? "Resident reports the issue" : "Reported during property walk"}; ${priority === "Emergency" ? "needs immediate response" : "please schedule"}.`,
    category: spec[0], priority, source, status, vendor_id: vendor, assignee_id: status === "New" ? null : tech, estimate_cents: estimate, cost_cents: completedDay ? (vendor ? cost : round(cost * 0.25, 100)) : null,
    sla_due_at: ts(Math.floor(sla / 1440), sla % 1440), opened_at: ts(opened, openedMin), scheduled_at: status === "New" || status === "Triaged" ? null : ts(opened + (priority === "Emergency" ? 0 : 1), 9 * 60 + pr.int(0, 8) * 60),
    completed_at: completedDay ? ts(Math.min(completedDay, ASOF), Math.min(openedMin + 120, 1380)) : null, permission_to_enter: pr.chance(0.9) ? 1 : 0,
  });
  c.workOrders.push(row);
  // Event trail.
  let seq = 0;
  const ev = (d: number, min: number, actorKind: string, actorId: string, kind: string, st: string | null, detail: object = {}) => {
    if (d > ASOF) return;
    add("wo_events", { id: `${id}-e${++seq}`, work_order_id: id, property_id: p.id, at: ts(d, Math.min(min, 1439)), actor_kind: actorKind, actor_id: actorId, kind, status: st, detail: JSON.stringify(detail) });
  };
  const opener = source === "Resident" && u ? u.leases.at(-1)?.hh.residents[0]?.id ?? "system" : p.manager;
  ev(opened, openedMin, source === "Resident" ? "resident" : source === "Preventive" ? "system" : "staff", opener as string, "Status", "New", { source });
  const recent = ASOF - opened < 120;
  if (recent || open) ev(opened, openedMin + 4, "agent", "maintenance_triage", "Status", "Triaged", { category: spec[0], priority, trade: spec[2], confidence: Math.round((0.78 + pr() * 0.2) * 100) / 100 });
  if (status !== "New" && status !== "Triaged") ev(opened, openedMin + 25, "staff", p.supervisor, "Assigned", "Assigned", { vendor_id: vendor, assignee_id: tech });
  if (recent && pr.chance(0.04)) ev(opened + 1, 600, "staff", p.supervisor, "Note", null, { note: "Vendor no-show for the 9–11 window; rescheduled for tomorrow morning." });
  if (completedDay) {
    if (vendor) ev(completedDay, Math.min(openedMin + 100, 1380), "vendor", vendor, "Submission", "Submitted", { total_cents: cost });
    ev(completedDay, Math.min(openedMin + 130, 1400), "staff", vendor ? p.supervisor : tech ?? p.supervisor, "Status", "Completed", {});
    if (recent && pr.chance(0.03)) {
      ev(completedDay + 3, 800, "resident", opener as string, "Note", null, { note: "Issue is back after the repair." });
      ev(completedDay + 3, 830, "staff", p.supervisor, "Status", "In progress", { reopened: true });
      ev(completedDay + 5, 900, "staff", p.supervisor, "Status", "Completed", {});
    }
  } else if (status === "Cancelled") ev(opened + 1, 600, "staff", p.manager, "Status", "Cancelled", { reason: "Duplicate of an earlier request" });
  else if (open && ["Scheduled", "In progress", "On hold", "Submitted"].includes(status)) {
    ev(opened + 1, 540, "staff", p.supervisor, "Status", status === "Submitted" ? "In progress" : status, {});
    if (status === "Submitted") ev(ASOF, 600, "vendor", vendor!, "Submission", "Submitted", { total_cents: cost, lines: [{ description: "Labor", amount_cents: round(cost * 0.6, 100) }, { description: "Parts", amount_cents: cost - round(cost * 0.6, 100) }] });
    if (status === "On hold") ev(opened + 1, 700, "staff", p.supervisor, "Note", null, { note: "On hold: waiting on parts (ETA 3–5 business days)." });
  }
  if (spec[5] && recent && (open || pr.chance(0.35))) {
    add("photos", { id: `ph-${id}`, entity_type: "work_orders", entity_id: id, property_id: p.id, url: `/img/wo/wo-${spec[5]}.webp`, caption: spec[1], stage: "Before", taken_at: ts(opened, openedMin + 2), check_result: pr.chance(0.9) ? "Matches" : "Unclear", check_confidence: Math.round((0.7 + pr() * 0.28) * 100) / 100, check_note: null });
  }
  if (completedDay && vendor && !c.sealed) c.bill(p, vendor, [["6000", `${spec[1]}${unitNo} (${id})`, cost]], completedDay + pr.int(1, 3), { wo: id });
  return row;
}

// ---------------------------------------------------------------------------------------------
// Management fees and owner payouts (period cutoff by seq: a payout closes everything before it)
// ---------------------------------------------------------------------------------------------

function ownerPayouts(c: Ctx) {
  const { add, je } = c;
  // Management fee on each cleared rent receipt into trust (as money.ts settle does).
  for (const tr of [...c.t.transfers]) {
    if (tr.kind !== "Rent" || tr.status !== "Cleared") continue;
    const fee = pctOf(tr.amount_cents as number, FEE_PCT);
    if (!fee) continue;
    const d = day(tr.created as string);
    add("transfers", { id: `tr-fee-${(tr.id as string).slice(3)}`, key: `fee:${tr.id}`, kind: "Management fee", bank_account_id: tr.bank_account_id, owner_entity_id: tr.owner_entity_id, from_kind: "trust", from_id: tr.bank_account_id, from_name: "Operating trust", to_kind: "pm", to_id: "ba-mgmt", to_name: `${ORG_NAME} (management fees)`, amount_cents: fee, property_id: tr.property_id, ref: tr.id, status: "Cleared", created: ts(d, 17 * 60 + 30), settles_at: null, cleared: ts(d + 1, 10 * 60) });
    je(tr.property_id as string, "6300", ym(d), fee, 0);
    je(tr.property_id as string, "1010", ym(d), 0, fee);
  }
  const reserveOf = Object.fromEntries(ENTITIES.map(([id, , , , r]) => [id, r * 100]));
  const byEntity = new Map<string, R[]>();
  for (const tr of c.t.transfers) if (String(tr.bank_account_id).endsWith("-trust")) (byEntity.get(tr.owner_entity_id as string) ?? byEntity.set(tr.owner_entity_id as string, []).get(tr.owner_entity_id as string)!).push(tr);
  for (const [oe, list] of [...byEntity].sort()) {
    list.sort((a, b) => (a.created! < b.created! ? -1 : a.created! > b.created! ? 1 : 0));
    const owner = ENTITIES.find(([id]) => id === oe)!;
    const R0 = reserveOf[oe];
    let reserveHeld = 0;
    let idx = 0;
    const open: R[] = [];
    for (const period of PERIODS.slice(0, -1)) {
      const close = ts(monthEnd(period), 23 * 60 + 59);
      while (idx < list.length && (list[idx].created as string) < close) open.push(list[idx++]);
      let income = 0, expense = 0, fee = 0;
      const byProp = new Map<string, number>();
      for (const x of open) {
        if (x.status !== "Cleared") continue;
        const a = x.amount_cents as number;
        const sign = x.kind === "Rent" || x.kind === "Other receipt" ? 1 : -1;
        if (sign > 0) income += a;
        else if (x.kind === "Management fee") fee += a;
        else expense += a;
        byProp.set(x.property_id as string, (byProp.get(x.property_id as string) ?? 0) + sign * a);
      }
      const net = income - expense - fee;
      // Corrupted case: one statement paid a cent short (rounding); the cent stays in trust.
      const shortCent = oe === "oe05" && period === "2026-08" ? 1 : 0;
      const amount = reserveHeld + net - R0 - shortCent;
      if (amount <= 0) continue;
      if (shortCent) (c.planted["owner_distributions.rounding_cent"] ??= []).push(`od-${oe}-${period}`);
      const id = `tr-own-${oe}-${period}`;
      const ownerName = OWNERS.find(([id]) => id === owner[1])![1];
      add("transfers", { id, key: `owner:${oe}:${period}`, kind: "Owner payout", bank_account_id: `ba-${oe}-trust`, owner_entity_id: oe, from_kind: "trust", from_id: `ba-${oe}-trust`, from_name: "Operating trust", to_kind: "owner", to_id: owner[1], to_name: ownerName, amount_cents: amount, property_id: [...byProp.keys()].sort()[0], ref: `Statement ${period}`, status: "Cleared", created: close, settles_at: null, cleared: ts(monthEnd(period) + 2, 10 * 60) });
      add("owner_distributions", { id: `od-${oe}-${period}`, owner_entity_id: oe, transfer_id: id, period, income_cents: income, expense_cents: expense, fee_cents: fee, reserve_cents: net - amount - shortCent, amount_cents: amount, paid_on: iso(monthEnd(period)) });
      // Allocate the payout to properties by their share of the period's net.
      const props = [...byProp].filter(([, v]) => v > 0).sort();
      const pos = props.reduce((s, [, v]) => s + v, 0);
      let left = amount;
      props.forEach(([pid, v], i) => {
        const share = i === props.length - 1 ? left : Math.floor((amount * v) / pos);
        left -= share;
        je(pid, "3100", period, share, 0);
        je(pid, "1010", period, 0, share);
      });
      reserveHeld = R0;
      open.length = 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Budgets and pre-aggregated metrics
// ---------------------------------------------------------------------------------------------

function budgetsAndMetrics(c: Ctx, jeMap: Map<string, [number, number]>) {
  const { add } = c;
  const glType = Object.fromEntries(GL.map(([n, , type]) => [n, type]));
  const actual = (prop: string, g: string, period: string) => {
    const v = jeMap.get(`${prop}|${g}|${period}`);
    if (!v) return 0;
    return glType[g] === "Income" ? v[1] - v[0] : v[0] - v[1];
  };
  const pnlGls = GL.filter(([, , type]) => type === "Income" || type === "Expense").map(([n]) => n);
  // Properties whose budget assumed better results (they show "below budget NOI").
  const optimistic = new Set(["p09", "p11", "p16", "p28", "p20"]);
  const budgetNoi = new Map<string, number>();
  for (const p of c.props) {
    for (const year of [2025, 2026]) {
      const bid = `bud-${p.id}-${year}`;
      add("budgets", { id: bid, property_id: p.id, year, status: year === 2026 ? "Approved" : "Approved", approved_by: p.region === "r-tx" ? "priya" : p.region === "r-se" ? "s-wanjiru" : "s-colton" });
      for (let m = 1; m <= 12; m++) {
        const period = `${year}-${String(m).padStart(2, "0")}`;
        const src = period < FIRST_PERIOD ? addMonths(period, 12) : period > "2026-10" ? addMonths(period, -12) : period;
        let noi = 0;
        for (const g of pnlGls) {
          const a = actual(p.id, g, src);
          if (!a || g === "6900") continue;
          const br = rng(`budget:${p.id}:${g}:${period}`);
          const lift = glType[g] === "Income" ? (optimistic.has(p.id) ? 1.07 : 1.01) + br.normal(0, 0.015) : 1 + br.normal(0.01, 0.04);
          const amt = round(a * lift * (src !== period ? 1.03 : 1), 100);
          add("budget_lines", { id: `bdl-${p.id}-${g}-${period}`, budget_id: bid, property_id: p.id, gl_account_id: gl(g), period, amount_cents: amt });
          noi += glType[g] === "Income" ? amt : -amt;
        }
        budgetNoi.set(`${p.id}|${period}`, noi);
      }
    }
  }

  const charges = c.t.charges, payments = c.t.payments, credits = c.t.credits ?? [];
  const sumBy = (rows: R[], key: (r: R) => string | null, val: (r: R) => number) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + val(r));
    }
    return m;
  };
  const charged = sumBy(charges, (r) => `${r.property_id}|${r.period}`, (r) => r.amount_cents as number);
  const collected = sumBy(payments, (r) => (r.nsf ? null : `${r.property_id}|${(r.received_on as string).slice(0, 7)}`), (r) => r.amount_cents as number);
  const conc = sumBy(credits, (r) => (r.kind === "Concession" ? `${r.property_id}|${(r.on_date as string).slice(0, 7)}` : null), (r) => r.amount_cents as number);
  // Aging at each period end: open balance per charge by days past due.
  const paidBy = new Map<string, { d: string; a: number }[]>();
  for (const p of payments) if (!p.nsf && p.charge_id) (paidBy.get(p.charge_id as string) ?? paidBy.set(p.charge_id as string, []).get(p.charge_id as string)!).push({ d: p.received_on as string, a: p.amount_cents as number });
  const credBy = new Map<string, { d: string; a: number }[]>();
  for (const x of credits) if (x.charge_id) (credBy.get(x.charge_id as string) ?? credBy.set(x.charge_id as string, []).get(x.charge_id as string)!).push({ d: x.on_date as string, a: x.amount_cents as number });
  const aging = new Map<string, [number, number, number, number]>();
  for (const period of PERIODS) {
    const cut = period === CURRENT_PERIOD ? ASOF : monthEnd(period);
    const cutIso = iso(cut);
    for (const ch of charges) {
      if ((ch.due_on as string) > cutIso) continue;
      let rem = ch.amount_cents as number;
      for (const x of paidBy.get(ch.id as string) ?? []) if (x.d <= cutIso) rem -= x.a;
      for (const x of credBy.get(ch.id as string) ?? []) if (x.d <= cutIso) rem -= x.a;
      if (rem <= 0) continue;
      const age = cut - day(ch.due_on as string);
      const k = `${ch.property_id}|${period}`;
      const a = aging.get(k) ?? aging.set(k, [0, 0, 0, 0]).get(k)!;
      a[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += rem;
    }
  }
  const woOpened = sumBy(c.workOrders, (r) => `${r.property_id}|${(r.opened_at as string).slice(0, 7)}`, () => 1);
  const slaBreach = sumBy(c.workOrders, (r) => ((r.completed_at ?? `${AS_OF}T23:59:00Z`) > (r.sla_due_at as string) && r.status !== "Cancelled" ? `${r.property_id}|${(r.opened_at as string).slice(0, 7)}` : null), () => 1);

  for (const p of c.props) {
    for (const period of PERIODS) {
      const cut = period === CURRENT_PERIOD ? ASOF : monthEnd(period);
      const ms = monthStart(period);
      const k = `${p.id}|${period}`;
      let occupied = 0, gpr = 0, vacancyLoss = 0, moveIns = 0, moveOuts = 0;
      for (const u of p.units) {
        gpr += u.market;
        const live = u.leases.some((l) => l.status !== "Future" && l.start <= cut && (l.moveOut ?? Infinity) >= cut);
        if (live) occupied++;
        else vacancyLoss += u.market;
        for (const l of u.leases) {
          if (l.status !== "Future" && !l.renewalOf && l.start >= ms && l.start <= cut) moveIns++;
          if (l.moveOut && l.moveOut >= ms && l.moveOut <= cut) moveOuts++;
        }
      }
      let income = 0, opex = 0;
      for (const g of pnlGls) {
        const a = actual(p.id, g, period);
        if (glType[g] === "Income") income += a;
        else opex += a;
      }
      const ag = aging.get(k) ?? [0, 0, 0, 0];
      const woOpen = c.workOrders.filter((w) => w.property_id === p.id && (w.opened_at as string) <= ts(cut, 1439) && (!w.completed_at || (w.completed_at as string) > ts(cut, 1439)) && w.status !== "Cancelled").length;
      add("metrics_monthly", {
        property_id: p.id, month: period, units: p.units.length, occupied, gpr_cents: gpr, charged_cents: charged.get(k) ?? 0, collected_cents: collected.get(k) ?? 0,
        vacancy_loss_cents: vacancyLoss, concessions_cents: conc.get(k) ?? 0, occupancy_phys: Math.round((occupied / p.units.length) * 10000) / 10000,
        occupancy_econ: Math.round(Math.max(0, Math.min(1, (actual(p.id, "4000", period) + actual(p.id, "4010", period) + actual(p.id, "4900", period)) / gpr)) * 10000) / 10000,
        aging_0_30_cents: ag[0], aging_31_60_cents: ag[1], aging_61_90_cents: ag[2], aging_90p_cents: ag[3], opex_cents: opex, noi_cents: income - opex,
        budget_noi_cents: budgetNoi.get(k) ?? null, wo_opened: woOpened.get(k) ?? 0, wo_open: woOpen, wo_sla_breach: slaBreach.get(k) ?? 0, move_ins: moveIns, move_outs: moveOuts,
        leads: 0, tours: 0, applications: 0, ai_actions: 0, ai_minutes_saved: 0,
      });
    }
  }
}
