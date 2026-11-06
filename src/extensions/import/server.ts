import "server-only";
import { z } from "zod";
import { can, getEntity } from "@/entities";
import type { EntityKey, Role } from "@/entities/types";
import { APPEND_ONLY } from "@/server/effective";
import type { Db, DbStatement } from "@/lib/platform/types";
import { demoNowIso } from "@/lib/clock";
import { formatAsOf } from "@/lib/format";
import { editable, effective, forgetOverlay, QueryError, type QueryCtx, type WriteCtx } from "@/server/query";
import { AS_OF } from "@/seed/constants";
import type { Payload } from "./assemble";
import { glFor, key } from "./normalize";
import { toolLabel } from "./presets";
import { PROPERTY_TYPES, TYPE_LABEL, type ImportTableName } from "./labels";
import { REF_COLUMNS } from "./refs";

// The write side of an import. plan() resolves every cleaned record against the visitor's data
// (natural keys, role, scope) and builds the rows; commit() writes them in one D1 batch whose first
// statement is a lock row, so a double click or retry writes nothing twice. Ids carry the batch
// ("uni-i<batch>-<n>"), which is what undo() deletes. Everything lands in the visitor's overlay.

const SRC = z.object({ file: z.string().max(40), line: z.number().int().min(0).max(1_000_000) });
const s = (n = 200) => z.string().max(n);
const money = z.number().finite().min(-1e8).max(1e8);
const person = z.object({ first: s(80), last: s(80), email: s(160).optional(), phone: s(20).optional() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Unit statuses as the units entity def lists them (src/entities/defs/portfolio.ts).
const UNIT_STATUS = z.enum(["Occupied", "Vacant", "Notice", "Make-ready", "Down", "Model"]);
const PROPERTY_TYPE = z.enum(PROPERTY_TYPES);
const ordered = (r: { start?: string; end?: string }) => !r.start || !r.end || r.end >= r.start;
export const PayloadSchema = z.object({
  properties: z.array(z.object({ key: s(), name: s().min(1), street: s(), city: s(80), state: s(2), zip: s(10), type: PROPERTY_TYPE.optional(), yearBuilt: z.number().int().min(1700).max(2100).optional(), unitCount: z.number().int().min(0).max(10_000).optional(), owner: s().optional(), src: SRC })).max(500),
  units: z.array(z.object({ property: s(), number: s(30).min(1), sqft: z.number().int().min(0).max(1_000_000).optional(), marketRent: money.optional(), status: UNIT_STATUS.optional(), src: SRC })).max(6000),
  residents: z.array(person.extend({ property: s(), unit: s(30).optional(), status: z.enum(["Current", "Notice", "Past", "Future", "Eviction"]), src: SRC })).max(6000),
  leases: z.array(z.object({ property: s(), unit: s(30), people: z.array(person).min(1).max(8), start: date, end: date.optional(), moveIn: date.optional(), moveOut: date.optional(), rent: money.positive(), deposit: money.positive().optional(), status: z.enum(["Future", "Active", "Notice", "Month-to-month", "Expired", "Terminated", "Eviction"]), externalId: s(60).optional(), src: SRC }).refine(ordered, "Lease ends before it starts")).max(6000),
  owners: z.array(z.object({ name: s().min(1), entity: s().optional(), email: s(160).optional(), phone: s(20).optional(), state: s(2).optional(), taxLast4: z.string().regex(/^\d{4}$/).optional(), feePct: z.number().min(0).max(1).optional(), src: SRC })).max(2000),
  vendors: z.array(z.object({ company: s().min(1), trade: s(60), contact: s(120).optional(), email: s(160).optional(), phone: s(20).optional(), taxLast4: z.string().regex(/^\d{4}$/).optional(), is1099: z.boolean().optional(), status: z.enum(["Active", "Inactive", "Do not use"]).optional(), src: SRC })).max(2000),
  balances: z.array(z.object({ property: s(), unit: s(30), tenant: s().optional(), buckets: z.tuple([money.min(0), money.min(0), money.min(0), money.min(0)]), src: SRC })).max(6000),
  recurring: z.array(z.object({ property: s(), unit: s(30), label: s(60).min(1), amount: money.positive(), frequency: z.enum(["Monthly", "Quarterly", "Annually", "Weekly"]), start: date.optional(), end: date.optional(), src: SRC }).refine(ordered, "Charge ends before it starts")).max(6000),
});
export const OptionsSchema = z.object({
  tool: s(30),
  reports: z.array(s(80)).max(10),
  files: z.array(s(120)).max(10),
  portfolioId: s(80).optional(),
  propertyType: PROPERTY_TYPE.optional(),
  ai: z.object({ model: s(80), suggestions: z.number().int().min(0).max(1000), accepted: z.number().int().min(0).max(1000) }).optional(),
});
export const ImportRequest = z.object({ mode: z.enum(["preview", "commit"]), payload: PayloadSchema, options: OptionsSchema });
export const UndoRequest = z.object({ batch: z.string().regex(/^[0-9a-f]{10}$/) });
export type ImportOptions = z.infer<typeof OptionsSchema>;

// Tables an import writes, in dependency order, with the id prefix and the entity that owns them.
const TABLES = {
  owners: { prefix: "own", entity: "owners" },
  owner_entities: { prefix: "owe", entity: "owner_entities" },
  portfolios: { prefix: "por", entity: "portfolios" },
  properties: { prefix: "pro", entity: "properties" },
  units: { prefix: "uni", entity: "units" },
  households: { prefix: "hou", entity: "households" },
  residents: { prefix: "res", entity: "residents" },
  leases: { prefix: "lea", entity: "leases" },
  deposits: { prefix: "dep", entity: "deposits" },
  recurring_charges: { prefix: "rec", entity: "recurring_charges" },
  charges: { prefix: "cha", entity: "charges" },
  vendors: { prefix: "ven", entity: "vendors" },
} as const satisfies Record<ImportTableName, { prefix: string; entity: EntityKey }>;
export type ImportTable = keyof typeof TABLES;
export const IMPORT_TABLES = Object.keys(TABLES) as ImportTable[];

// Ledger records (opening balances, deposits, recurring charges) have no generic create; staff who
// may record payments may bring them over.
const LEDGER_ROLES: Role[] = ["principal", "regional_manager", "property_manager", "accountant"];
const LEDGER = new Set<ImportTable>(["charges", "deposits", "recurring_charges"]);
export const mayCreate = (role: Role, table: ImportTable) => (LEDGER.has(table) ? LEDGER_ROLES.includes(role) && can(role, "read", TABLES[table].entity) : can(role, "create", TABLES[table].entity));

const ACTIVE = new Set(["Active", "Notice", "Month-to-month", "Eviction"]);
const AGE_DAYS = [15, 45, 75, 105];
const AGE_LABEL = ["0–30 days", "31–60 days", "61–90 days", "over 90 days"];
const DALLAS = /^(dallas|plano|irving|garland|frisco|arlington|fort worth|richardson|mckinney|carrollton|denton|grand prairie|mesquite|addison)$/i;
const metroFor = (city: string, state: string) => (state === "GA" ? "Atlanta" : state === "AZ" ? "Phoenix" : DALLAS.test(city.trim()) ? "Dallas" : "Austin");
const daysBefore = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const months = (a: string, b?: string) => (b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 86_400_000))) : null);
const cents = (n: number | undefined) => (n == null ? 0 : Math.round(n * 100));

type Row = Record<string, string | number | null>;
type Skip = { type: string; label: string; reason: string; line?: string };
export type PlanSummary = Record<ImportTable, { new: number; existing: number; skipped: number }>;
export type Plan = {
  batch: string;
  rows: Record<ImportTable, Row[]>;
  summary: PlanSummary;
  skipped: Skip[];
  matched: { type: string; label: string; href: string }[];
  samples: Record<ImportTable, { label: string; detail: string }[]>;
  notes: string[];
};

async function hash(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const all = async <T>(db: Db, sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<T>()).results;

// Every row of a small reference table, read in id order in pages so nothing is cut off.
async function scan<T extends { id: string }>(db: Db, from: string, cols: string, where = "1 = 1"): Promise<T[]> {
  const out: T[] = [];
  for (let after = ""; ; ) {
    const page = await all<T>(db, `SELECT ${cols} FROM ${from} AS t WHERE ${where} AND t.id > ? ORDER BY t.id LIMIT 2000`, after);
    out.push(...page);
    if (page.length < 2000) return out;
    after = page.at(-1)!.id;
  }
}

// IN lists go through json_each in chunks, so no single bound value grows without limit.
async function inChunks<T>(values: string[], size: number, run: (chunk: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += size) out.push(...(await run(JSON.stringify(values.slice(i, i + size)))));
  return out;
}

export async function plan(ctx: QueryCtx, payload: Payload, opts: ImportOptions): Promise<Plan> {
  const { db, ws, actor } = ctx;
  const role = actor.role;
  const E = (t: string) => effective(t, ws);
  const batch = await hash(JSON.stringify({ payload, opts: { ...opts, ai: undefined } }));
  const rows = Object.fromEntries(IMPORT_TABLES.map((t) => [t, [] as Row[]])) as Plan["rows"];
  const summary = Object.fromEntries(IMPORT_TABLES.map((t) => [t, { new: 0, existing: 0, skipped: 0 }])) as PlanSummary;
  const skipped: Skip[] = [];
  const matched: Plan["matched"] = [];
  const notes: string[] = [];
  const seq: Partial<Record<ImportTable, number>> = {};
  const newId = (t: ImportTable) => `${TABLES[t].prefix}-i${batch}-${(seq[t] = (seq[t] ?? 0) + 1)}`;
  const href = (t: ImportTable, id: string) => `${getEntity(TABLES[t].entity)?.route ?? ""}/${id}`;
  const at = (src?: { file: string; line: number }) => (src ? `${src.file}:${src.line}` : undefined);
  const skip = (t: ImportTable, label: string, reason: string, src?: { file: string; line: number }) => { summary[t].skipped++; if (skipped.length < 300) skipped.push({ type: t, label, reason, line: at(src) }); };
  const found = (t: ImportTable, label: string, id: string) => { summary[t].existing++; if (matched.length < 300) matched.push({ type: t, label, href: href(t, id) }); };
  // fromFile: columns whose value came from the file (the rest are defaults), for the note below.
  const add = (t: ImportTable, row: Row, fromFile: string[] = []) => {
    const def = getEntity(TABLES[t].entity)!;
    // Field rules from the entity defs: a column the role may not set on create keeps its default.
    // The rule depends only on the role, so every row of a table keeps the same columns.
    for (const [k, f] of Object.entries(def.fields)) {
      const col = f.column ?? k;
      if (col in row && col !== "id" && !LEDGER.has(t) && !f.sql && !editable(role, k, f, "create")) {
        const note = `${def.label.many}: ${f.label.toLowerCase()} is set by another role, so it was left at its default.`;
        if (fromFile.includes(col) && !notes.includes(note)) notes.push(note);
        delete row[col];
      }
    }
    rows[t].push(row);
    summary[t].new++;
    return row;
  };
  const allowed = (t: ImportTable) => mayCreate(role, t);
  const inScope = (pid: string) => actor.propertyIds === "all" || actor.propertyIds.includes(pid);

  // ------------------------------------------------------------------ owners and entities
  const [owners, entities, portfolios, regions, props, banks] = await Promise.all([
    scan<{ id: string; name: string; email: string }>(db, E("owners"), "t.id, t.name, t.email"),
    scan<{ id: string; name: string; owner_id: string; org_id: string }>(db, E("owner_entities"), "t.id, t.name, t.owner_id, t.org_id"),
    scan<{ id: string; owner_entity_id: string; org_id: string }>(db, E("portfolios"), "t.id, t.owner_entity_id, t.org_id"),
    all<{ id: string; states: string }>(db, `SELECT id, states FROM ${E("regions")}`),
    scan<{ id: string; name: string; street: string; city: string; org_id: string; owner_entity_id: string }>(db, E("properties"), "t.id, t.name, t.street, t.city, t.org_id, t.owner_entity_id"),
    all<{ id: string }>(db, `SELECT id FROM ${E("bank_accounts")} WHERE kind = 'Deposit'`),
  ]);
  const org = props[0]?.org_id ?? entities[0]?.org_id ?? "org-summit";
  const ownerIds = new Map<string, string>();
  for (const o of owners) { ownerIds.set(key(o.name), o.id); if (o.email) ownerIds.set(o.email.toLowerCase(), o.id); }
  const entityIds = new Map(entities.map((e) => [key(e.name), e.id] as const));
  const portfolioOf = new Map<string, string>();
  for (const p of portfolios) if (!portfolioOf.has(p.owner_entity_id)) portfolioOf.set(p.owner_entity_id, p.id);
  const newEntities = new Set<string>();

  for (const o of payload.owners) {
    let ownerId = ownerIds.get(key(o.name)) ?? (o.email ? ownerIds.get(o.email.toLowerCase()) : undefined);
    if (ownerId) found("owners", o.name, ownerId);
    else if (!allowed("owners")) skip("owners", o.name, "Your role can't add owners", o.src);
    else {
      ownerId = String(add("owners", { id: newId("owners"), name: o.name, kind: o.entity && key(o.entity) !== key(o.name) ? "Individual" : /fund|trust|llc|lp\b|partners|holdings|capital/i.test(o.name) ? "Fund" : "Individual", email: o.email ?? "", phone: o.phone ?? "", portal_enabled: 0 }).id);
      ownerIds.set(key(o.name), ownerId);
    }
    if (!o.entity || !ownerId) continue;
    const eid = entityIds.get(key(o.entity));
    if (eid) { found("owner_entities", o.entity, eid); continue; }
    if (!allowed("owner_entities")) { skip("owner_entities", o.entity, "Your role can't add owner entities", o.src); continue; }
    const id = String(add("owner_entities", { id: newId("owner_entities"), org_id: org, owner_id: ownerId, name: o.entity, ein_last4: o.taxLast4 ?? "", state: o.state ?? "", mgmt_fee_pct: o.feePct ?? 0.08, reserve_cents: 0 }).id);
    entityIds.set(key(o.entity), id);
    newEntities.add(id);
    if (allowed("portfolios")) portfolioOf.set(id, String(add("portfolios", { id: newId("portfolios"), org_id: org, owner_entity_id: id, name: `${o.entity.replace(/,?\s*(LLC|LP|Inc\.?)$/i, "")} portfolio` }).id));
  }

  // ------------------------------------------------------------------ properties
  const defaultPortfolio = portfolios.find((p) => p.id === opts.portfolioId) ?? portfolios[0];
  const propIds = new Map<string, string | null>(); // payload key → property id (null = skipped)
  const newProps = new Set<string>();
  const byName = new Map(props.map((p) => [key(p.name), p] as const));
  const byStreet = new Map(props.filter((p) => p.street).map((p) => [`${key(p.street)}|${key(p.city)}`, p] as const));
  const unitsFor = new Map<string, number>();
  for (const u of payload.units) unitsFor.set(u.property, (unitsFor.get(u.property) ?? 0) + 1);
  for (const p of payload.properties) {
    const hit = byName.get(key(p.name)) ?? (p.street ? byStreet.get(`${key(p.street)}|${key(p.city)}`) : undefined);
    if (hit) {
      if (!inScope(hit.id)) { propIds.set(p.key, null); skip("properties", p.name, "Already on file, but outside your scope", p.src); continue; }
      propIds.set(p.key, hit.id);
      found("properties", p.name, hit.id);
      continue;
    }
    propIds.set(p.key, null);
    if (!allowed("properties")) { skip("properties", p.name, "New properties need a principal or regional manager", p.src); continue; }
    const region = regions.find((r) => { try { return (JSON.parse(r.states) as string[]).includes(p.state); } catch { return false; } });
    if (!p.street || !p.city || !p.state) { skip("properties", p.name, "Needs a street, city and state to be created", p.src); continue; }
    if (!region) { skip("properties", p.name, `No region covers ${p.state}; add one in Settings first`, p.src); continue; }
    if (actor.scope.kind === "region" && !(actor.scope.ids ?? []).includes(region.id)) { skip("properties", p.name, "Its region is outside your scope", p.src); continue; }
    const entityId = (p.owner && entityIds.get(key(p.owner))) || undefined;
    const portfolioId = entityId ? portfolioOf.get(entityId) : undefined;
    const pf = entityId && portfolioId ? { id: portfolioId, owner_entity_id: entityId } : defaultPortfolio;
    if (!pf) { skip("properties", p.name, "No portfolio to put it in", p.src); continue; }
    if (p.owner && !entityId) notes.push(`${p.name}: owner "${p.owner}" isn't on file, so it was added to the chosen portfolio's owner.`);
    const id = String(add("properties", {
      id: newId("properties"), org_id: org, region_id: region.id, portfolio_id: pf.id, owner_entity_id: pf.owner_entity_id, manager_id: null, name: p.name,
      type: p.type || opts.propertyType || "Garden multifamily", class: null, metro: metroFor(p.city, p.state), neighborhood: "", street: p.street, city: p.city, state: p.state, zip: p.zip,
      year_built: p.yearBuilt ?? null, unit_count: p.unitCount ?? unitsFor.get(p.key) ?? 0, amenities: "[]", photos: "[]", status: "Stabilized",
    }).id);
    propIds.set(p.key, id);
    newProps.add(id);
  }
  const propLabel = new Map(payload.properties.map((p) => [p.key, p.name] as const));
  const ownerOfProp = new Map(props.map((p) => [p.id, p.owner_entity_id] as const));
  for (const r of rows.properties) ownerOfProp.set(String(r.id), String(r.owner_entity_id));

  // ------------------------------------------------------------------ units
  const existingPids = [...new Set([...propIds.values()].filter((x): x is string => !!x && !newProps.has(x)))];
  const [units, residents] = existingPids.length
    ? await Promise.all([
        all<{ id: string; property_id: string; number: string }>(db, `SELECT id, property_id, number FROM ${E("units")} WHERE property_id IN (SELECT value FROM json_each(?))`, JSON.stringify(existingPids)),
        inChunks([...new Set([...payload.residents, ...payload.leases.flatMap((l) => l.people)].map((x) => `${x.first} ${x.last}`.toLowerCase()))], 500, (names) =>
          all<{ id: string; property_id: string; household_id: string; first_name: string; last_name: string; email: string }>(db, `SELECT id, property_id, household_id, first_name, last_name, email FROM ${E("residents")} WHERE property_id IN (SELECT value FROM json_each(?)) AND lower(first_name || ' ' || last_name) IN (SELECT value FROM json_each(?))`, JSON.stringify(existingPids), names)),
      ])
    : [[], []];
  const unitId = new Map<string, string | null>(); // `${pid}|${NUMBER}` → id
  for (const u of units) unitId.set(`${u.property_id}|${u.number.trim().toUpperCase()}`, u.id);
  const unitLabel = (pk: string, n: string) => `${propLabel.get(pk) ?? pk} #${n}`;
  const unitOf = (pk: string, n: string) => { const pid = propIds.get(pk); return pid ? unitId.get(`${pid}|${n}`) ?? null : null; };
  for (const u of payload.units) {
    const pid = propIds.get(u.property);
    const label = unitLabel(u.property, u.number);
    if (!pid) { skip("units", label, "Its property isn't being imported", u.src); continue; }
    const k = `${pid}|${u.number}`;
    if (unitId.get(k)) { found("units", label, unitId.get(k)!); continue; }
    if (!allowed("units")) { skip("units", label, "Your role can't add units", u.src); continue; }
    unitId.set(k, String(add("units", { id: newId("units"), property_id: pid, number: u.number, sqft: u.sqft ?? 0, market_rent_cents: cents(u.marketRent), status: u.status ?? "Vacant", available_on: null }).id));
  }

  // ------------------------------------------------------------------ leases, households, residents
  const onFile = [...new Set(units.map((u) => u.id))];
  const leases = onFile.length
    ? await all<{ id: string; property_id: string; unit_id: string; household_id: string; status: string; start_on: string; end_on: string | null }>(db, `SELECT id, property_id, unit_id, household_id, status, start_on, end_on FROM ${E("leases")} WHERE unit_id IN (SELECT value FROM json_each(?))`, JSON.stringify(onFile))
    : [];
  const sameStart = new Map(leases.map((l) => [`${l.unit_id}|${l.start_on}`, l.id] as const));
  const leaseAt = new Map<string, { id: string; household: string; property: string; unit: string; isNew: boolean; start: string; end?: string | null }>();
  const curLease = new Map<string, (typeof leases)[number]>();
  for (const l of leases) {
    const k = l.unit_id;
    if (ACTIVE.has(l.status) && (!curLease.has(k) || l.start_on > curLease.get(k)!.start_on)) curLease.set(k, l);
  }
  for (const l of leases) if (!leaseAt.has(l.unit_id) && curLease.get(l.unit_id)?.id === l.id) leaseAt.set(l.unit_id, { id: l.id, household: l.household_id, property: l.property_id, unit: l.unit_id, isNew: false, start: l.start_on, end: l.end_on });
  const resKey = (pid: string, first: string, last: string) => `${pid}|${`${first} ${last}`.toLowerCase()}`;
  const residentIds = new Map(residents.map((r) => [resKey(r.property_id, r.first_name, r.last_name), r] as const));
  const resStatus = (s: string) => (s === "Notice" ? "Notice" : s === "Future" ? "Future" : s === "Expired" || s === "Terminated" ? "Past" : s === "Eviction" ? "Eviction" : "Current");
  const addResidents = (pid: string, household: string, people: { first: string; last: string; email?: string; phone?: string }[], status: string) => {
    people.forEach((x, i) => {
      if (residentIds.has(resKey(pid, x.first, x.last))) { found("residents", `${x.first} ${x.last}`, residentIds.get(resKey(pid, x.first, x.last))!.id); return; }
      const row = add("residents", { id: newId("residents"), household_id: household, property_id: pid, first_name: x.first, last_name: x.last, email: x.email ?? "", phone: x.phone ?? "", preferred_channel: "Email", language: "en", is_primary: i === 0 ? 1 : 0, status, autopay: 0 });
      residentIds.set(resKey(pid, x.first, x.last), { id: String(row.id), property_id: pid, household_id: household, first_name: x.first, last_name: x.last, email: x.email ?? "" });
    });
  };
  const leaseLabel = (l: { property: string; unit: string; people: { first: string; last: string }[] }) => `${unitLabel(l.property, l.unit)} · ${l.people.map((x) => `${x.first} ${x.last}`.trim()).join(", ")}`;
  const leaseByExt = new Map<string, string>();
  for (const l of payload.leases) {
    const label = leaseLabel(l);
    const pid = propIds.get(l.property);
    const uid = unitOf(l.property, l.unit);
    if (!pid || !uid) { skip("leases", label, pid ? "Its unit isn't being imported" : "Its property isn't being imported", l.src); continue; }
    const cur = leaseAt.get(uid);
    const same = sameStart.get(`${uid}|${l.start}`);
    if (same) { found("leases", label, same); continue; }
    if (cur && ACTIVE.has(l.status)) { skip("leases", label, cur.isNew ? "The unit already has a current lease in this import" : "The unit already has a current lease on file", l.src); continue; }
    if (!allowed("leases") || !allowed("residents")) { skip("leases", label, "Your role can't add leases and residents", l.src); continue; }
    if (l.externalId && leaseByExt.has(l.externalId)) { skip("leases", label, `Same lease id as ${leaseByExt.get(l.externalId)}`, l.src); continue; }
    const household = String(add("households", { id: newId("households"), property_id: pid, name: `${l.people[0]!.last || l.people[0]!.first} household` }).id);
    addResidents(pid, household, l.people, resStatus(l.status));
    const id = String(add("leases", {
      id: newId("leases"), property_id: pid, unit_id: uid, household_id: household, application_id: null, renewal_of: null, kind: "Residential", status: l.status,
      start_on: l.start, end_on: l.end ?? null, move_in_on: l.moveIn ?? (l.start <= AS_OF ? l.start : null), move_out_on: l.moveOut ?? null, notice_on: null, term_months: months(l.start, l.end),
      rent_cents: cents(l.rent), deposit_cents: cents(l.deposit), escalations: "[]", balance_cents: 0,
    }).id);
    if (l.externalId) leaseByExt.set(l.externalId, label);
    if (!cur || ACTIVE.has(l.status)) leaseAt.set(uid, { id, household, property: pid, unit: uid, isNew: true, start: l.start, end: l.end });
    if (l.deposit && l.deposit > 0) {
      const bank = `ba-${ownerOfProp.get(pid)}-dep`;
      if (!allowed("deposits")) skip("deposits", label, "Your role can't add deposit records; the amount stays on the lease", l.src);
      else if (!banks.some((b) => b.id === bank)) skip("deposits", label, "No security-deposit bank account for the owner; the amount stays on the lease", l.src);
      else add("deposits", { id: newId("deposits"), lease_id: id, property_id: pid, bank_account_id: bank, amount_cents: cents(l.deposit), received_on: l.moveIn ?? l.start, status: "Held" });
    }
  }
  // Directory residents not on a rent roll: join the unit's current household, else get their own.
  const households = new Map<string, string>();
  for (const r of payload.residents) {
    const label = `${r.first} ${r.last}`.trim();
    const pid = propIds.get(r.property);
    if (!pid) { skip("residents", label, "Their property isn't being imported", r.src); continue; }
    if (residentIds.has(resKey(pid, r.first, r.last))) { found("residents", label, residentIds.get(resKey(pid, r.first, r.last))!.id); continue; }
    if (!allowed("residents") || !allowed("households")) { skip("residents", label, "Your role can't add residents", r.src); continue; }
    const uid = r.unit ? unitOf(r.property, r.unit) : null;
    const hk = `${pid}|${r.unit ?? ""}|${key(r.last)}`;
    let household = (uid && leaseAt.get(uid)?.household) || households.get(hk);
    if (!household) household = String(add("households", { id: newId("households"), property_id: pid, name: `${r.last || r.first} household` }).id);
    households.set(hk, household);
    addResidents(pid, household, [r], r.status);
  }

  // ------------------------------------------------------------------ balances and recurring charges
  const leaseFor = (pk: string, n: string) => { const uid = unitOf(pk, n); return uid ? leaseAt.get(uid) : undefined; };
  const touched = [...new Set(payload.recurring.map((b) => leaseFor(b.property, b.unit)).filter((l) => l && !l.isNew).map((l) => l!.id))];
  const recurrings = await inChunks(touched, 500, (ids) => all<{ lease_id: string; label: string }>(db, `SELECT lease_id, label FROM ${E("recurring_charges")} WHERE lease_id IN (SELECT value FROM json_each(?))`, ids));
  const hasRecurring = new Set(recurrings.map((r) => `${r.lease_id}|${key(r.label)}`));
  // Opening balances go only on leases this import creates. A lease already on file has a ledger
  // (charges, payments, credits) that its balance comes from; adding to it would count twice.
  const hasOpening = new Set<string>();
  for (const b of payload.balances) {
    const label = `${unitLabel(b.property, b.unit)}${b.tenant ? ` · ${b.tenant}` : ""}`;
    const l = leaseFor(b.property, b.unit);
    if (!l) { skip("charges", label, "No current lease on this unit to post the balance to", b.src); continue; }
    if (!l.isNew) { skip("charges", label, "Already on file — its balance comes from its ledger", b.src); continue; }
    if (hasOpening.has(l.id)) { skip("charges", label, "This lease already has a balance in this import", b.src); continue; }
    if (!allowed("charges")) { skip("charges", label, "Your role can't post balances", b.src); continue; }
    hasOpening.add(l.id);
    b.buckets.forEach((amt, i) => {
      if (amt <= 0) return;
      const due = daysBefore(AS_OF, AGE_DAYS[i]!);
      add("charges", { id: newId("charges"), lease_id: l.id, household_id: l.household, property_id: l.property, unit_id: l.unit, gl_account_id: "gl-4000", description: `Opening balance · ${AGE_LABEL[i]} (imported)`, period: due.slice(0, 7), due_on: due, amount_cents: cents(amt), paid_cents: 0, pending_cents: 0 });
    });
  }
  for (const r of payload.recurring) {
    const label = `${unitLabel(r.property, r.unit)} · ${r.label}`;
    const l = leaseFor(r.property, r.unit);
    if (!l) { skip("recurring_charges", label, "No current lease on this unit", r.src); continue; }
    const k = `${l.id}|${key(r.label)}`;
    if (hasRecurring.has(k)) { summary.recurring_charges.existing++; continue; }
    if (!allowed("recurring_charges")) { skip("recurring_charges", label, "Your role can't add recurring charges", r.src); continue; }
    hasRecurring.add(k);
    add("recurring_charges", { id: newId("recurring_charges"), lease_id: l.id, property_id: l.property, gl_account_id: glFor(r.label), label: r.label, amount_cents: cents(r.amount), frequency: r.frequency, start_on: r.start ?? l.start, end_on: r.end ?? l.end ?? null });
  }

  // ------------------------------------------------------------------ vendors
  const vendors = payload.vendors.length ? await scan<{ id: string; company: string; email: string }>(db, E("vendors"), "t.id, t.company, t.email") : [];
  const vendorIds = new Map<string, string>();
  for (const v of vendors) { vendorIds.set(key(v.company), v.id); if (v.email) vendorIds.set(v.email.toLowerCase(), v.id); }
  for (const v of payload.vendors) {
    const hit = vendorIds.get(key(v.company)) ?? (v.email ? vendorIds.get(v.email.toLowerCase()) : undefined);
    if (hit) { found("vendors", v.company, hit); continue; }
    if (!allowed("vendors")) { skip("vendors", v.company, "Your role can't add vendors", v.src); continue; }
    const given = [v.taxLast4 ? "tin_last4" : "", v.is1099 != null ? "is_1099" : ""];
    vendorIds.set(key(v.company), String(add("vendors", { id: newId("vendors"), company: v.company, trade: v.trade, contact_name: v.contact ?? "", email: v.email ?? "", phone: v.phone ?? "", metros: "[]", w9_on_file: 0, tin_last4: v.taxLast4 ?? "", is_1099: v.is1099 === false ? 0 : 1, bank_last4: "", status: v.status ?? "Active" }, given).id));
  }

  const describe = (t: ImportTable, r: Row): { label: string; detail: string } => {
    const name = (id: unknown) => rows.properties.find((p) => p.id === id)?.name ?? props.find((p) => p.id === id)?.name ?? String(id);
    const unitNo = (id: unknown) => rows.units.find((u) => u.id === id)?.number ?? units.find((u) => u.id === id)?.number ?? "";
    const $ = (c: unknown) => `$${(Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    switch (t) {
      case "properties": return { label: String(r.name), detail: `${r.street}, ${r.city}, ${r.state} ${r.zip}` };
      case "units": return { label: `${name(r.property_id)} #${r.number}`, detail: `${r.status} · market rent ${$(r.market_rent_cents)}` };
      case "residents": return { label: `${r.first_name} ${r.last_name}`.trim(), detail: `${name(r.property_id)} · ${r.status}` };
      case "leases": return { label: `${name(r.property_id)} #${unitNo(r.unit_id)}`, detail: `${r.status} · ${formatAsOf(r.start_on)} → ${r.end_on ? formatAsOf(r.end_on) : "month-to-month"} · ${$(r.rent_cents)}/mo` };
      case "charges": return { label: `${name(r.property_id)} #${unitNo(r.unit_id)}`, detail: `${r.description} · ${$(r.amount_cents)}` };
      case "recurring_charges": return { label: String(r.label), detail: `${name(r.property_id)} · ${$(r.amount_cents)} ${String(r.frequency).toLowerCase()}` };
      case "deposits": return { label: `${name(r.property_id)} #${unitNo(rows.leases.find((l) => l.id === r.lease_id)?.unit_id)}`, detail: `Security deposit ${$(r.amount_cents)} held` };
      case "vendors": return { label: String(r.company), detail: String(r.trade) };
      case "owners": return { label: String(r.name), detail: String(r.email || r.kind) };
      case "owner_entities": return { label: String(r.name), detail: `State ${r.state || "—"}` };
      default: return { label: String(r.name ?? r.id), detail: "" };
    }
  };
  const samples = Object.fromEntries(IMPORT_TABLES.map((t) => [t, rows[t].slice(0, 5).map((r) => describe(t, r))])) as Plan["samples"];
  return { batch, rows, summary, skipped, matched, samples, notes };
}

// ------------------------------------------------------------------ writing

// Rows go in as one JSON array per statement (two bound values, well under D1's 100), cut so each
// statement's SQL plus its JSON stays under D1's 100 KB statement limit.
export const CHUNK_BYTES = 90_000;
export function insertStatements(db: Db, ws: string, table: ImportTable, rows: Row[]): DbStatement[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]!);
  for (const c of cols) if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`Bad column ${c}`);
  const sql = `INSERT INTO ${table} (workspace_id, ${cols.join(", ")}) SELECT ?1, ${cols.map((c) => `json_extract(value, '$.${c}')`).join(", ")} FROM json_each(?2) WHERE true ON CONFLICT DO NOTHING`;
  const out: DbStatement[] = [];
  let chunk: string[] = [], size = sql.length + 2;
  const flush = () => { if (chunk.length) out.push(db.prepare(sql).bind(ws, `[${chunk.join(",")}]`)); chunk = []; size = sql.length + 2; };
  for (const r of rows) {
    const j = JSON.stringify(Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    if (size + j.length + 1 > CHUNK_BYTES) flush();
    chunk.push(j);
    size += j.length + 1;
  }
  flush();
  return out;
}

const generation = async (db: Db, ws: string, batch: string) =>
  (await db.prepare("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND action = 'import.undone' AND entity_id = ?").bind(ws, batch).first<{ n: number }>())?.n ?? 0;

export type ImportResult = { batch: string; created: Partial<Record<ImportTable, number>>; links: Partial<Record<ImportTable, { label: string; href: string }[]>>; lists: Partial<Record<ImportTable, string>> };

const auditInsert = (db: Db, ws: string, id: string, at: string, ctx: WriteCtx, action: string, batch: string, detail: string, after: unknown) =>
  db.prepare("INSERT INTO audit (workspace_id, id, at, actor, actor_id, role, action, entity_type, entity_id, property_id, detail, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'import', ?, NULL, ?, NULL, ?)")
    .bind(ws, id, at, ctx.actor.name, ctx.actor.personaId, ctx.actor.role, action, batch, detail, JSON.stringify(after));

const countText = (c: Partial<Record<ImportTable, number>>) => IMPORT_TABLES.filter((t) => c[t]).map((t) => `${c[t]} ${TYPE_LABEL[t][c[t] === 1 ? 0 : 1]}`).join(", ");

export async function commit(ctx: WriteCtx, payload: Payload, opts: ImportOptions): Promise<ImportResult> {
  const p = await plan(ctx, payload, opts);
  const created = Object.fromEntries(IMPORT_TABLES.filter((t) => p.rows[t].length).map((t) => [t, p.rows[t].length])) as ImportResult["created"];
  if (!Object.keys(created).length) throw new QueryError(409, "Nothing new to import: every record is already on file.");
  const { db, ws } = ctx;
  const at = demoNowIso(ctx.nowMs);
  const gen = await generation(db, ws, p.batch);
  const source = `${toolLabel(opts.tool)}${opts.reports.length ? ` (${opts.reports.join(", ")})` : ""}`;
  const stmts: DbStatement[] = [
    // The lock: a second run of this batch fails here on the audit row's unique id and writes nothing.
    auditInsert(db, ws, `import-${p.batch}-${gen}`, at, ctx, "import.completed", p.batch, `Imported from ${source}: ${countText(created)}`, { batch: p.batch, created, tables: Object.keys(created), files: opts.files, tool: opts.tool, reports: opts.reports, ai: opts.ai ?? null, skipped: p.skipped.length }),
    ...IMPORT_TABLES.flatMap((t) => insertStatements(db, ws, t, p.rows[t])),
    db.prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at) VALUES (?, ?, 'import.completed', 'import', ?, NULL, ?, ?)")
      .bind(ws, `evt-import-${p.batch}-${gen}`, p.batch, JSON.stringify({ properties: created.properties ?? 0, units: created.units ?? 0, leases: created.leases ?? 0, by: ctx.actor.personaId }), at),
  ];
  try {
    await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE constraint failed: audit/.test(String((e as Error)?.message ?? e))) throw new QueryError(409, "This import is already running or done.");
    throw e;
  }
  forgetOverlay(ctx.actor);
  const links = Object.fromEntries(IMPORT_TABLES.filter((t) => p.rows[t].length && t !== "households" && t !== "portfolios").map((t) => [t, p.rows[t].slice(0, 5).map((r, i) => ({ label: p.samples[t][i]?.label ?? String(r.id), href: `${getEntity(TABLES[t].entity)?.route}/${r.id}` }))]));
  const lists = Object.fromEntries(Object.keys(created).map((t) => [t, getEntity(TABLES[t as ImportTable].entity)?.route ?? ""]));
  return { batch: p.batch, created, links, lists };
}

// History and agent output that may mention an imported record without depending on it: logs stay
// as history, and agent proposals re-check their record before they can run.
const HISTORY = new Set(["audit", "activity_events", "events", "agent_runs", "agent_steps", "ai_proposals", "ai_decisions", "ai_summaries", "ai_feedback", "data_issues", "data_fix_log", "notifications", "metrics_monthly", "org_usage_monthly"]);

// Tables outside the batch whose live rows point at a batch row through any id column
// (REF_COLUMNS, from the schema). One EXISTS per table, 40 to a statement, all in one D1 batch.
export async function dependents(db: Db, ws: string, pattern: string): Promise<string[]> {
  const checks = Object.entries(REF_COLUMNS).filter(([t]) => !HISTORY.has(t)).map(([t, cols]) =>
    `EXISTS (SELECT 1 FROM ${t} WHERE workspace_id = ?1${APPEND_ONLY.has(t) ? "" : " AND deleted = 0"} AND id NOT LIKE ?2 AND (${cols.map((c) => `${c} LIKE ?2`).join(" OR ")}))`);
  const names = Object.keys(REF_COLUMNS).filter((t) => !HISTORY.has(t));
  const chunks = Array.from({ length: Math.ceil(checks.length / 40) }, (_, k) => checks.slice(k * 40, k * 40 + 40));
  const rs = await db.batch(chunks.map((c, k) => db.prepare(`SELECT ${c.map((x, i) => `${x} AS c${k * 40 + i}`).join(", ")}`).bind(ws, pattern)));
  const row = Object.assign({}, ...rs.map((r) => (r.results?.[0] ?? {}) as Record<string, number>));
  return names.filter((_, i) => row[`c${i}`]);
}

// Batch rows at properties outside the actor's scope (property-scoped tables only).
async function outOfScope(db: Db, ws: string, pattern: string, tables: ImportTable[], scope: string[] | "all") {
  if (scope === "all") return false;
  const col = (t: ImportTable) => (t === "properties" ? "id" : REF_COLUMNS[t]?.includes("property_id") ? "property_id" : null);
  const parts = tables.filter((t) => col(t)).map((t) => `EXISTS (SELECT 1 FROM ${t} WHERE workspace_id = ?1 AND id LIKE ?2 AND ${col(t)} NOT IN (SELECT value FROM json_each(?3)))`);
  if (!parts.length) return false;
  const r = await db.prepare(`SELECT ${parts.map((p, i) => `${p} AS c${i}`).join(", ")}`).bind(ws, pattern, JSON.stringify(scope)).first<Record<string, number>>();
  return Object.values(r ?? {}).some(Boolean);
}

export async function undo(ctx: WriteCtx, batch: string): Promise<{ batch: string; removed: Partial<Record<ImportTable, number>> }> {
  const { db, ws } = ctx;
  const done = await db.prepare("SELECT after_json FROM audit WHERE workspace_id = ? AND action = 'import.completed' AND entity_id = ? ORDER BY seq DESC LIMIT 1").bind(ws, batch).first<{ after_json: string }>();
  if (!done) throw new QueryError(404, "No import with that id in your workspace.");
  const gen = await generation(db, ws, batch);
  const completed = (await db.prepare("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND action = 'import.completed' AND entity_id = ?").bind(ws, batch).first<{ n: number }>())?.n ?? 0;
  if (gen >= completed) throw new QueryError(409, "This import was already undone.");
  const info = JSON.parse(done.after_json) as { created: Partial<Record<ImportTable, number>>; tables: ImportTable[] };
  const tables = info.tables.filter((t): t is ImportTable => t in TABLES);
  const denied = tables.filter((t) => !mayCreate(ctx.actor.role, t));
  if (denied.length) throw new QueryError(403, `Your role can't remove ${denied.map((t) => TYPE_LABEL[t][1]).join(", ")}.`);
  const pattern = `%-i${batch}-%`;
  if (await outOfScope(db, ws, pattern, tables, ctx.actor.propertyIds)) throw new QueryError(403, "Some records from this import are at properties outside your scope.");
  const blocking = await dependents(db, ws, pattern);
  if (blocking.length) throw new QueryError(409, `Other records point at records from this import (${blocking.map((t) => t.replace(/_/g, " ")).join(", ")}). Undo would leave them dangling, so remove or reassign those first.`);
  const at = demoNowIso(ctx.nowMs);
  try {
    await db.batch([
      auditInsert(db, ws, `import-${batch}-${gen}-undo`, at, ctx, "import.undone", batch, `Undid import: removed ${countText(info.created)}`, { batch, removed: info.created }),
      ...[...tables].reverse().map((t) => db.prepare(`DELETE FROM ${t} WHERE workspace_id = ?1 AND id LIKE ?2`).bind(ws, pattern)),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed: audit/.test(String((e as Error)?.message ?? e))) throw new QueryError(409, "This import was already undone.");
    throw e;
  }
  forgetOverlay(ctx.actor);
  return { batch, removed: info.created };
}

export type RecentImport = { batch: string; at: string; actor: string; detail: string; undone: boolean; created: Partial<Record<ImportTable, number>> };
export async function recentImports(db: Db, ws: string | null): Promise<RecentImport[]> {
  if (!ws) return [];
  const { results } = await db.prepare("SELECT action, at, actor, detail, entity_id, after_json FROM audit WHERE workspace_id = ? AND action IN ('import.completed', 'import.undone') ORDER BY seq DESC LIMIT 40").bind(ws).all<{ action: string; at: string; actor: string; detail: string; entity_id: string; after_json: string }>();
  const out: RecentImport[] = [];
  const undone = new Map<string, number>();
  for (const r of results) {
    if (r.action === "import.undone") { undone.set(r.entity_id, (undone.get(r.entity_id) ?? 0) + 1); continue; }
    const n = undone.get(r.entity_id) ?? 0;
    if (n) undone.set(r.entity_id, n - 1);
    let created = {};
    try { created = (JSON.parse(r.after_json) as { created: RecentImport["created"] }).created ?? {}; } catch { /* old row */ }
    out.push({ batch: r.entity_id, at: r.at, actor: r.actor, detail: r.detail, undone: n > 0, created });
  }
  return out.slice(0, 10);
}
