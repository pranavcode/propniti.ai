import "server-only";
import { cookies } from "next/headers";
import { getPlatform } from "@/lib/platform";
import type { Db } from "@/lib/platform/types";
import { effective, NO_WORKSPACE } from "@/server/effective";
import { readCookie } from "@/server/workspace";
import { AS_OF } from "@/seed/constants";
import { amenityMatch, AMENITY_FILTERS, METROS, petsSql, type AmenityKey, type Metro } from "./catalog";
import { RENTER_HELP, type RenterArticle } from "./renter-help";

// Public listings reads. Only Active listings on residential units (a unit type with beds) are
// public. Every read goes through effective(), so a visitor sees their own overlay edits.

export const PAGE_SIZE = 12;

type Raw = Record<string, unknown>;

export type ListingCard = {
  id: string; headline: string; rent_cents: number; prev_rent_cents: number | null; available_on: string | null; listed_on: string;
  unit: string; floor: number | null; sqft: number; beds: number; baths: number; plan: string;
  property_id: string; property: string; neighborhood: string; metro: string; city: string; state: string; type: string; pets: boolean;
  photo: string; special: string | null;
};

export type SearchParams = Record<string, string | string[] | undefined>;

export const SORTS = {
  newest: { label: "Newest", sql: "l.listed_on DESC, l.id" },
  "price-asc": { label: "Price: low to high", sql: "l.rent_cents ASC, l.id" },
  "price-desc": { label: "Price: high to low", sql: "l.rent_cents DESC, l.id" },
  available: { label: "Available soonest", sql: "coalesce(l.available_on, '0000') ASC, l.id" },
  size: { label: "Largest", sql: "u.sqft DESC, l.id" },
} as const;
export type SortKey = keyof typeof SORTS;

export async function visitorWorkspace() {
  const jar = await cookies();
  return readCookie(new Request("http://local/", { headers: { cookie: jar.toString() } })) ?? NO_WORKSPACE;
}

const db = () => getPlatform().db;
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

// 400 px thumbnails sit next to every generated image as <name>-400.webp.
export const thumb = (src: string) => src.replace(/\.webp$/, "-400.webp");

const FROM = `${effective("listings")} AS l
  JOIN ${effective("units")} AS u ON u.id = l.unit_id
  JOIN ${effective("unit_types")} AS ut ON ut.id = u.unit_type_id
  JOIN ${effective("properties")} AS p ON p.id = l.property_id`;
const PUBLIC = "l.status = 'Active'";
const SPECIAL = `(SELECT c.label FROM ${effective("concessions")} AS c WHERE c.property_id = p.id AND c.lease_id IS NULL AND c.status = 'Active' ORDER BY c.amount_cents DESC LIMIT 1)`;
const PREV = `(SELECT max(h.rent_cents) FROM ${effective("listing_price_history")} AS h WHERE h.listing_id = l.id)`;
const CARD_COLS = `l.id, l.headline, l.rent_cents, l.available_on, l.listed_on, l.photos AS l_photos, u.number AS unit, u.floor, u.sqft, ut.beds, ut.baths, ut.name AS plan,
  p.id AS property_id, p.name AS property, p.neighborhood, p.metro, p.city, p.state, p.type, p.photos AS p_photos, ${petsSql("p")} AS pets, ${SPECIAL} AS special, ${PREV} AS prev_rent_cents`;

function card(r: Raw): ListingCard {
  const photos = [...json<string[]>(r.l_photos, []), ...json<string[]>(r.p_photos, [])];
  const prev = r.prev_rent_cents == null ? null : Number(r.prev_rent_cents);
  return {
    id: String(r.id), headline: String(r.headline), rent_cents: Number(r.rent_cents), prev_rent_cents: prev != null && prev > Number(r.rent_cents) ? prev : null,
    available_on: (r.available_on as string) ?? null, listed_on: String(r.listed_on), unit: String(r.unit), floor: r.floor == null ? null : Number(r.floor), sqft: Number(r.sqft),
    beds: Number(r.beds), baths: Number(r.baths), plan: String(r.plan), property_id: String(r.property_id), property: String(r.property), neighborhood: String(r.neighborhood),
    metro: String(r.metro), city: String(r.city), state: String(r.state), type: String(r.type), pets: !!r.pets, photo: photos[0] ?? `/img/props/${r.property_id}.webp`,
    special: (r.special as string) ?? null,
  };
}

export type Filters = { q: string; metro: Metro | ""; beds: number[]; min: number | null; max: number | null; pets: boolean; amenities: AmenityKey[]; available: string; sort: SortKey; page: number };

const int = (v: string | undefined) => (v && /^\d{1,6}$/.test(v) ? Number(v) : null);

export function parseFilters(raw: SearchParams): Filters {
  // Checkbox groups arrive as repeated keys (beds=1&beds=2) or a comma list; both work.
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v])) as Record<string, string | undefined>;
  const metro = METROS.find((m) => m.toLowerCase() === (sp.metro ?? "").toLowerCase()) ?? "";
  const beds = (sp.beds ?? "").split(",").filter(Boolean).map(Number).filter((b) => [0, 1, 2, 3].includes(b));
  const amenities = (sp.amenities ?? "").split(",").filter((a): a is AmenityKey => a in AMENITY_FILTERS);
  return {
    q: (sp.q ?? "").trim().slice(0, 80), metro, beds: [...new Set(beds)], min: int(sp.min), max: int(sp.max), pets: sp.pets === "1", amenities,
    available: /^\d{4}-\d{2}-\d{2}$/.test(sp.available ?? "") ? sp.available! : "", sort: (sp.sort && sp.sort in SORTS ? sp.sort : "newest") as SortKey,
    page: Math.min(Math.max(int(sp.page) ?? 1, 1), 500),
  };
}

function whereFor(f: Filters, params: unknown[]) {
  const w = [PUBLIC];
  const p = (v: unknown) => (params.push(v), `?${params.length}`);
  if (f.q) {
    const like = p(`%${f.q.replace(/[%_]/g, "")}%`);
    w.push(`(p.name LIKE ${like} OR p.neighborhood LIKE ${like} OR p.city LIKE ${like} OR p.zip LIKE ${like} OR p.metro LIKE ${like} OR l.headline LIKE ${like})`);
  }
  if (f.metro) w.push(`p.metro = ${p(f.metro)}`);
  if (f.beds.length) w.push(`(${f.beds.map((b) => (b === 3 ? "ut.beds >= 3" : `ut.beds = ${b}`)).join(" OR ")})`);
  if (f.min != null) w.push(`l.rent_cents >= ${p(f.min * 100)}`);
  if (f.max != null) w.push(`l.rent_cents <= ${p(f.max * 100)}`);
  if (f.pets) w.push(petsSql("p"));
  for (const a of f.amenities) w.push(amenityMatch(a, "p"));
  if (f.available) w.push(`coalesce(l.available_on, '0000') <= ${p(f.available)}`);
  return w.join(" AND ");
}

export async function searchListings(ws: string, f: Filters) {
  const params: unknown[] = [ws];
  const where = whereFor(f, params);
  const size = PAGE_SIZE;
  const [rows, count] = await Promise.all([
    db().prepare(`SELECT ${CARD_COLS} FROM ${FROM} WHERE ${where} ORDER BY ${SORTS[f.sort].sql} LIMIT ${size} OFFSET ${(f.page - 1) * size}`).bind(...params).all<Raw>(),
    db().prepare(`SELECT count(*) AS n FROM ${FROM} WHERE ${where}`).bind(...params).first<{ n: number }>(),
  ]);
  return { rows: rows.results.map(card), total: count?.n ?? 0, page: f.page, size };
}

// Per-metro counts and starting rent for the metro chooser (ignores the metro filter itself).
export async function metroSummary(ws: string) {
  const { results } = await db().prepare(`SELECT p.metro, count(*) AS n, min(l.rent_cents) AS from_cents FROM ${FROM} WHERE ${PUBLIC} GROUP BY p.metro`).bind(ws).all<{ metro: string; n: number; from_cents: number }>();
  return METROS.map((m) => results.find((r) => r.metro === m) ?? { metro: m, n: 0, from_cents: 0 });
}

export type Special = { label: string; amount_cents: number };
export type ListingDetail = ListingCard & {
  description: string; unit_id: string; unit_type_id: string; class: string | null; street: string; zip: string; year_built: number | null; stories: number | null;
  amenities: string[]; property_photos: string[]; unit_photos: string[]; specials: Special[]; history: { rent_cents: number; changed_on: string; reason: string }[];
  parking: { subtype: string; rent_cents: number; n: number }[]; storage_from_cents: number | null; lat: number | null; lng: number | null;
  siblings: ListingCard[]; terms: Terms;
};

export async function getListing(ws: string, id: string): Promise<ListingDetail | null> {
  const r = await db()
    .prepare(`SELECT ${CARD_COLS}, l.description, u.id AS unit_id, ut.id AS unit_type_id, ut.photos AS ut_photos, p.class, p.street, p.zip, p.year_built, p.stories, p.amenities, p.lat, p.lng
      FROM ${FROM} WHERE ${PUBLIC} AND l.id = ?2`)
    .bind(ws, id)
    .first<Raw>();
  if (!r) return null;
  const base = card(r);
  const [specials, history, parking, storage, siblings] = await Promise.all([
    db().prepare(`SELECT label, amount_cents FROM ${effective("concessions")} AS c WHERE c.property_id = ?2 AND c.lease_id IS NULL AND c.status = 'Active' ORDER BY amount_cents DESC LIMIT 5`).bind(ws, base.property_id).all<Special>(),
    db().prepare(`SELECT rent_cents, changed_on, reason FROM ${effective("listing_price_history")} AS h WHERE h.listing_id = ?2 ORDER BY changed_on DESC LIMIT 6`).bind(ws, id).all<{ rent_cents: number; changed_on: string; reason: string }>(),
    db().prepare(`SELECT subtype, min(rent_cents) AS rent_cents, count(*) AS n FROM ${effective("rentable_items")} AS ri WHERE ri.property_id = ?2 AND ri.kind = 'Parking' GROUP BY subtype ORDER BY rent_cents`).bind(ws, base.property_id).all<{ subtype: string; rent_cents: number; n: number }>(),
    db().prepare(`SELECT min(rent_cents) AS c FROM ${effective("rentable_items")} AS ri WHERE ri.property_id = ?2 AND ri.kind = 'Storage'`).bind(ws, base.property_id).first<{ c: number | null }>(),
    db().prepare(`SELECT ${CARD_COLS} FROM ${FROM} WHERE ${PUBLIC} AND p.id = ?2 AND l.id <> ?3 ORDER BY abs(ut.beds - ?4), l.rent_cents LIMIT 6`).bind(ws, base.property_id, id, base.beds).all<Raw>(),
  ]);
  const amenities = json<string[]>(r.amenities, []);
  const detail = {
    ...base, description: String(r.description ?? ""), unit_id: String(r.unit_id), unit_type_id: String(r.unit_type_id), class: (r.class as string) ?? null, street: String(r.street), zip: String(r.zip),
    year_built: r.year_built == null ? null : Number(r.year_built), stories: r.stories == null ? null : Number(r.stories), amenities,
    property_photos: [...json<string[]>(r.l_photos, []), ...json<string[]>(r.p_photos, [])], unit_photos: json<string[]>(r.ut_photos, []),
    specials: specials.results, history: history.results, parking: parking.results, storage_from_cents: storage?.c ?? null,
    lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng), siblings: siblings.results.map(card),
  };
  return { ...detail, terms: listingTerms(detail) };
}

// Leasing terms the schema has no columns for yet (lane-requests.md, "listing terms"). Derived in
// one place from the property so the page, the Q&A and the application all quote the same figures.
// INTEGRATE: read listings.terms once the leasing lane adds it.
export type Terms = {
  application_fee_cents: number; deposit_cents: number; admin_fee_cents: number; lease_months: number[];
  pets: { allowed: boolean; deposit_cents: number; monthly_cents: number; max: number; note: string };
  laundry: string | null; parking: string | null; utilities: string; income_multiple: number;
};

export function listingTerms(l: Pick<ListingDetail, "rent_cents" | "class" | "amenities" | "type" | "pets" | "parking">): Terms {
  const a = new Set(l.amenities);
  const deposit = l.class === "A" ? Math.round(l.rent_cents / 2 / 5000) * 5000 : l.class === "C" ? 30000 : 50000;
  const garage = l.parking.find((p) => p.subtype === "Garage");
  const parking = a.has("Attached garages") ? "Attached garage included with the home"
    : a.has("Off-street parking") || a.has("Ample parking") ? "Surface parking included, one space per bedroom"
    : garage ? `Garage parking from $${(garage.rent_cents / 100).toFixed(0)}/month`
    : l.parking.length ? `Reserved parking from $${(l.parking[0].rent_cents / 100).toFixed(0)}/month` : null;
  return {
    application_fee_cents: 5000, admin_fee_cents: l.class === "A" ? 25000 : 15000, deposit_cents: deposit, lease_months: l.type === "Townhomes" || l.type === "Small residential" ? [12, 18] : [6, 12, 13, 15],
    pets: l.pets ? { allowed: true, deposit_cents: 30000, monthly_cents: 3500, max: 2, note: "Up to 2 cats or dogs per home." } : { allowed: false, deposit_cents: 0, monthly_cents: 0, max: 0, note: "No pets." },
    laundry: a.has("In-unit laundry") || l.class === "A" ? "Washer and dryer in the home" : null,
    parking,
    utilities: "Electricity and internet are in your name. Water, sewer and trash are billed monthly by usage.",
    income_multiple: 3,
  };
}

// Due before move-in: first month's rent, the security deposit and the administration fee.
export const moveInCents = (l: Pick<ListingDetail, "rent_cents" | "terms">) => l.rent_cents + l.terms.deposit_cents + l.terms.admin_fee_cents;

// Renter help: seeded help_articles with ids renter-*, or the built-in copy until Lane A seeds them.
export async function renterHelp(ws: string): Promise<RenterArticle[]> {
  const { results } = await db().prepare(`SELECT id, title, body FROM ${effective("help_articles")} AS h WHERE h.id LIKE 'renter-%' ORDER BY h.id LIMIT 20`).bind(ws).all<RenterArticle>();
  return results.length ? results : RENTER_HELP;
}

export const today = () => AS_OF;

// The leasing agent assigned to the property (role_assignments), if any.
export async function leasingAgent(db: Db, ws: string, propertyId: string) {
  return db.prepare(`SELECT s.id, s.name FROM ${effective("role_assignments")} AS ra JOIN ${effective("staff")} AS s ON s.id = ra.staff_id
    WHERE ra.role = 'leasing_agent' AND ra.scope_kind = 'property' AND ra.scope_id = ?2 LIMIT 1`).bind(ws, propertyId).first<{ id: string; name: string }>();
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Bookable tour slots: the next 14 days after the demo's today, 9:00–17:30 (Sundays 12:00–16:30).
export function tourSlots(from = AS_OF) {
  return Array.from({ length: 14 }, (_, i) => {
    const date = addDays(from, i + 1);
    const sunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
    const [start, end] = sunday ? [12, 17] : [9, 18];
    const times: string[] = [];
    for (let h = start; h < end; h++) times.push(`${String(h).padStart(2, "0")}:00`, `${String(h).padStart(2, "0")}:30`);
    return { date, times };
  });
}


export type ApplicationStatus = {
  id: string; stage: string; first_name: string; email: string;
  proposal: { title: string; why: string[]; confidence: number; model: string | null; run_id: string | null } | null;
};

// The visitor's own application and the Leasing agent's proposal for it, if the run has finished.
export async function applicationStatus(ws: string, id: string): Promise<ApplicationStatus | null> {
  const a = await db().prepare(`SELECT a.id, a.stage, ap.first_name, ap.email FROM ${effective("applications")} AS a JOIN ${effective("applicants")} AS ap ON ap.id = a.applicant_id WHERE a.id = ?2 AND a.workspace_id = ?1`)
    .bind(ws, id).first<Omit<ApplicationStatus, "proposal">>();
  if (!a) return null;
  const p = await db().prepare(`SELECT title, why, confidence, model, run_id FROM ${effective("ai_proposals")} AS p WHERE p.entity_type = 'applications' AND p.entity_id = ?2 ORDER BY p.created_at DESC LIMIT 1`)
    .bind(ws, id).first<{ title: string; why: string; confidence: number; model: string | null; run_id: string | null }>();
  return { ...a, proposal: p ? { ...p, why: json<string[]>(p.why, []) } : null };
}
