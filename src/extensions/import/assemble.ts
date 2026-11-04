import { FIELDS, KIND_SPECS, type FieldKey, type Kind } from "./fields";
import type { Mapping } from "./mapping";
import * as N from "./normalize";
import type { Sheet, SourceRow } from "./parse";

// Mapped rows → the records to import, plus row issues. Deterministic: the same files, mapping and
// accepted fixes always give the same records. Runs in the browser; the server re-checks the
// result before writing.

export type ImportFile = { id: string; name: string; kind: Kind; sheet: Sheet; mapping: Mapping; preset?: string; defaultProperty?: string; excluded: number[] };
// An accepted fix: cells of `field` equal to `from` (on `line`, when given) read as `to`.
export type Edit = { file: string; field: FieldKey; from: string; to: string; line?: number };
export type Src = { file: string; line: number };
export type Issue = Src & { severity: "error" | "warning"; message: string; field?: FieldKey };
export type Suggestion = {
  id: string; file: string; field: FieldKey; kind: "replace" | "exclude" | "swap";
  from?: string; to?: string; line?: number; other?: FieldKey;
  reason: string; confidence: number; source: "rules" | "ai"; rows: number;
};

export type PersonRec = { first: string; last: string; email?: string; phone?: string };
export type PropertyRec = { key: string; name: string; street: string; city: string; state: string; zip: string; type?: string; yearBuilt?: number; unitCount?: number; owner?: string; src: Src };
export type UnitRec = { property: string; number: string; sqft?: number; marketRent?: number; status?: string; src: Src };
export type ResidentRec = PersonRec & { property: string; unit?: string; status: N.ResidentStatus; src: Src };
export type LeaseRec = { property: string; unit: string; people: PersonRec[]; start: string; end?: string; moveIn?: string; moveOut?: string; rent: number; deposit?: number; status: N.LeaseStatus; externalId?: string; src: Src };
export type OwnerRec = { name: string; entity?: string; email?: string; phone?: string; state?: string; taxLast4?: string; feePct?: number; src: Src };
export type VendorRec = { company: string; trade: string; contact?: string; email?: string; phone?: string; taxLast4?: string; is1099?: boolean; status?: string; src: Src };
export type BalanceRec = { property: string; unit: string; tenant?: string; buckets: [number, number, number, number]; src: Src };
export type RecurringRec = { property: string; unit: string; label: string; amount: number; frequency: string; start?: string; end?: string; src: Src };
export type Payload = { properties: PropertyRec[]; units: UnitRec[]; residents: ResidentRec[]; leases: LeaseRec[]; owners: OwnerRec[]; vendors: VendorRec[]; balances: BalanceRec[]; recurring: RecurringRec[] };
export const RECORD_TYPES = ["properties", "units", "residents", "leases", "owners", "vendors", "balances", "recurring"] as const satisfies readonly (keyof Payload)[];
export type RecordType = (typeof RECORD_TYPES)[number];

export type Cleanup = Record<string, number>;
export type Assembled = { payload: Payload; issues: Issue[]; suggestions: Suggestion[]; cleanup: Record<string, Cleanup>; rows: Record<string, number> };

const ORDER: Kind[] = ["properties", "owners", "units", "rent_roll", "residents", "vendors", "balances", "recurring"];
const ACTIVE = new Set<N.LeaseStatus>(["Active", "Notice", "Month-to-month", "Eviction"]);
const FREQ: Record<string, string> = { monthly: "Monthly", month: "Monthly", mo: "Monthly", quarterly: "Quarterly", annually: "Annually", annual: "Annually", yearly: "Annually", weekly: "Weekly" };

export function assemble(files: ImportFile[], edits: Edit[], today: string): Assembled {
  const issues: Issue[] = [];
  const cleanup: Record<string, Cleanup> = {};
  const rowsIn: Record<string, number> = {};
  const props = new Map<string, PropertyRec>();
  const units = new Map<string, UnitRec>();
  const leases: LeaseRec[] = [];
  const residents: ResidentRec[] = [];
  const owners = new Map<string, OwnerRec>();
  const vendors = new Map<string, VendorRec>();
  const balances: BalanceRec[] = [];
  const recurring: RecurringRec[] = [];
  const rents: { lease: LeaseRec; src: Src }[] = [];

  for (const f of [...files].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))) {
    const fixes = edits.filter((e) => e.file === f.id);
    const excluded = new Set(f.excluded);
    const tally: Cleanup = (cleanup[f.id] = {});
    const count = (what: string) => (tally[what] = (tally[what] ?? 0) + 1);
    const raw = (r: SourceRow, field: FieldKey) => {
      const m = f.mapping[field];
      let v = m ? (r.cells[m.col] ?? "").trim() : "";
      for (const e of fixes) if (e.field === field && e.from === v && (e.line == null || e.line === r.line)) v = e.to;
      return v;
    };
    const issue = (r: SourceRow, severity: Issue["severity"], message: string, field?: FieldKey) => issues.push({ file: f.id, line: r.line, severity, message, field });
    // Typed reads that record cleanup counts and issues.
    const get = {
      money(r: SourceRow, field: FieldKey) {
        const v = raw(r, field);
        if (!v) return undefined;
        const n = N.money(v);
        if (n == null) { issue(r, "error", `${FIELDS[field].label} "${v}" isn't an amount`, field); return undefined; }
        if (/[$,()]/.test(v)) count("Amounts with $ or commas read as numbers");
        return n;
      },
      date(r: SourceRow, field: FieldKey) {
        const v = raw(r, field);
        if (!v) return undefined;
        const d = N.date(v);
        if (!d) { issue(r, "error", `${FIELDS[field].label} "${v}" isn't a date`, field); return undefined; }
        if (d !== v) count("Dates converted to YYYY-MM-DD");
        return d;
      },
      phone(r: SourceRow, field: FieldKey = "phone") {
        const v = raw(r, field);
        if (!v) return undefined;
        const p = N.phone(v);
        if (!p) { issue(r, "warning", `Phone "${v}" isn't a 10-digit US number; left blank`, field); return undefined; }
        if (p !== v) count("Phone numbers formatted");
        return p;
      },
      email(r: SourceRow, field: FieldKey = "email") {
        const v = raw(r, field);
        if (!v) return undefined;
        const e = N.email(v);
        if (!e) { issue(r, "warning", `Email "${v}" looks invalid; left blank`, field); return undefined; }
        if (e !== v) count("Emails trimmed to the first address");
        return e;
      },
      int(r: SourceRow, field: FieldKey) {
        const v = raw(r, field);
        if (!v) return undefined;
        const n = N.int(v);
        if (n == null) issue(r, "warning", `${FIELDS[field].label} "${v}" isn't a whole number; left blank`, field);
        return n ?? undefined;
      },
      unit(r: SourceRow) {
        const v = raw(r, "unit");
        const u = N.unit(v);
        if (u && u !== v) count("Unit numbers cleaned (Unit 4B, #4B → 4B)");
        return u;
      },
    };

    const propertyOf = (r: SourceRow): PropertyRec | null => {
      let name = raw(r, "property");
      let fromSection: string | undefined;
      if (!name && r.section) {
        const [n, ...rest] = r.section.split(/\s+-\s+/);
        name = n!.trim();
        fromSection = rest.join(" - ");
      }
      if (!name && f.defaultProperty) name = f.defaultProperty;
      if (!name) { issue(r, "error", "No property name on this row", "property"); return null; }
      const k = N.key(name);
      const full = raw(r, "address") || fromSection || "";
      const parsed = N.address(full);
      const st = raw(r, "state");
      const next: PropertyRec = {
        key: k, name: name.replace(/\s+/g, " ").trim(),
        street: raw(r, "street") || parsed?.street || (full && !parsed ? full : ""),
        city: raw(r, "city") || parsed?.city || "",
        state: (st ? N.state(st) : null) ?? parsed?.state ?? "",
        zip: N.zip(raw(r, "zip")) ?? parsed?.zip ?? "",
        type: raw(r, "propertyType") || undefined, yearBuilt: get.int(r, "yearBuilt"), unitCount: get.int(r, "unitCount"),
        owner: raw(r, "owner") || undefined, src: { file: f.id, line: r.line },
      };
      if (st && !N.state(st)) issue(r, "warning", `State "${st}" isn't a US state`, "state");
      if (raw(r, "zip") && !N.zip(raw(r, "zip"))) issue(r, "warning", `ZIP "${raw(r, "zip")}" isn't a 5-digit ZIP`, "zip");
      if (full && !parsed && !raw(r, "street")) issue(r, "warning", `Couldn't split "${full}" into street, city, state and ZIP`, "address");
      if (st && N.state(st) !== st) count("States written as two-letter codes");
      const cur = props.get(k);
      if (!cur) props.set(k, next);
      else for (const [key, v] of Object.entries(next) as [keyof PropertyRec, never][]) if (!cur[key] && v) cur[key] = v;
      return props.get(k)!;
    };
    const ensureUnit = (p: PropertyRec, number: string, r: SourceRow, extra: Partial<UnitRec> = {}) => {
      const k = `${p.key}|${number}`;
      const cur = units.get(k);
      if (!cur) units.set(k, { property: p.key, number, ...extra, src: { file: f.id, line: r.line } });
      else for (const [key, v] of Object.entries(extra) as [keyof UnitRec, never][]) if (cur[key] == null && v != null) cur[key] = v;
    };
    const personFrom = (r: SourceRow): N.Person[] => {
      const first = raw(r, "firstName"), last = raw(r, "lastName");
      if (first || last) return [{ first, last }];
      const t = raw(r, "tenant");
      const list = N.people(t);
      if (t.includes(",") && list.length) count("Names written Last, First split");
      return list;
    };

    const seen = new Map<string, { line: number; sig: string; active: boolean }>();
    let lease: LeaseRec | null = null;
    let vacantContext = false;
    const rows = f.sheet.rows.filter((r) => !excluded.has(r.line));
    rowsIn[f.id] = rows.length;

    for (const r of rows) {
      const sig = r.cells.join("\u0001");
      if (f.kind === "properties") { propertyOf(r); continue; }

      if (f.kind === "owners") {
        const p = personFrom(r)[0];
        const person = p ? [p.first, p.last].filter(Boolean).join(" ") : raw(r, "ownerName");
        const entity = raw(r, "entityName");
        const name = person || entity;
        if (!name) { issue(r, "error", "No owner or company name", "ownerName"); continue; }
        const k = `${N.key(name)}|${N.key(entity)}`;
        if (owners.has(k)) { issue(r, "warning", `Same owner as row ${owners.get(k)!.src.line}; skipped`); continue; }
        const st = raw(r, "state") ? N.state(raw(r, "state")) : N.address(raw(r, "address"))?.state;
        const fee = raw(r, "feePct");
        if (fee && N.pct(fee) == null) issue(r, "warning", `Management fee "${fee}" isn't a percentage; left blank`, "feePct");
        owners.set(k, { name, entity: entity || undefined, email: get.email(r), phone: get.phone(r), state: st ?? undefined, taxLast4: N.taxLast4(raw(r, "taxId")) ?? undefined, feePct: N.pct(fee) ?? undefined, src: { file: f.id, line: r.line } });
        if (raw(r, "taxId").replace(/\D/g, "").length > 4) count("Tax IDs cut to their last 4 digits");
        continue;
      }

      if (f.kind === "vendors") {
        const company = raw(r, "company");
        if (!company) { issue(r, "error", "No vendor company name", "company"); continue; }
        const k = N.key(company);
        if (vendors.has(k)) { issue(r, "warning", `Same vendor as row ${vendors.get(k)!.src.line}; skipped`); continue; }
        const status = raw(r, "vendorStatus");
        const b = raw(r, "is1099");
        vendors.set(k, {
          company, trade: raw(r, "trade").split(/[,;]/)[0]!.trim() || "General", contact: raw(r, "contactName") || undefined, email: get.email(r), phone: get.phone(r),
          taxLast4: N.taxLast4(raw(r, "taxId")) ?? undefined, is1099: b ? N.bool(b) ?? undefined : undefined,
          status: /inactive|no$|false/i.test(status) ? "Inactive" : /do not|dnu|blocked/i.test(status) ? "Do not use" : "Active", src: { file: f.id, line: r.line },
        });
        if (raw(r, "taxId").replace(/\D/g, "").length > 4) count("Tax IDs cut to their last 4 digits");
        continue;
      }

      // Yardi-style lease charge rows: no unit and no tenant, just a charge code and amount.
      const code = raw(r, "chargeCode");
      if (f.kind === "rent_roll" && !raw(r, "unit") && !raw(r, "tenant") && code && raw(r, "chargeAmount")) {
        const amt = get.money(r, "chargeAmount");
        if (vacantContext || amt == null) continue;
        if (!lease) { issue(r, "error", "Charge row with no unit above it", "chargeCode"); continue; }
        if (N.isRentCode(code)) lease.rent = Math.round(((lease.rent || 0) + amt) * 100) / 100;
        else if (amt > 0) recurring.push({ property: lease.property, unit: lease.unit, label: code, amount: amt, frequency: "Monthly", start: lease.start, end: lease.end, src: { file: f.id, line: r.line } });
        continue;
      }

      const p = propertyOf(r);
      if (!p) continue;
      const number = get.unit(r);

      if (f.kind === "units") {
        if (!number) { issue(r, "error", "No unit number", "unit"); continue; }
        const k = `${p.key}|${number}`;
        if (seen.has(k)) { issue(r, seen.get(k)!.sig === sig ? "warning" : "error", seen.get(k)!.sig === sig ? `Exact copy of row ${seen.get(k)!.line}; skipped` : `Unit ${number} is also on row ${seen.get(k)!.line}. Exclude one of the two rows.`, "unit"); continue; }
        seen.set(k, { line: r.line, sig, active: false });
        const st = raw(r, "unitStatus");
        ensureUnit(p, number, r, { sqft: get.int(r, "sqft"), marketRent: get.money(r, "marketRent"), status: N.unitStatus(st) ?? undefined });
        continue;
      }

      if (f.kind === "residents") {
        const status = N.residentStatus(raw(r, "residentStatus"));
        if (status === "vacant") continue;
        const list = personFrom(r);
        if (!list.length) { issue(r, "error", "No resident name", "tenant"); continue; }
        const email = get.email(r), phone = get.phone(r), moveIn = get.date(r, "moveIn");
        void moveIn;
        list.forEach((person, i) => {
          const k = `${p.key}|${number ?? ""}|${N.key(person.first + " " + person.last)}`;
          if (seen.has(k)) { issue(r, "warning", `${person.first} ${person.last} is also on row ${seen.get(k)!.line}; skipped`); return; }
          seen.set(k, { line: r.line, sig, active: false });
          residents.push({ property: p.key, unit: number ?? undefined, first: person.first, last: person.last, email: i === 0 ? email : undefined, phone: i === 0 ? phone : undefined, status: status ?? "Current", src: { file: f.id, line: r.line } });
        });
        continue;
      }

      if (!number) { issue(r, "error", "No unit number", "unit"); continue; }

      if (f.kind === "balances") {
        const b = [get.money(r, "aging0"), get.money(r, "aging30"), get.money(r, "aging60"), get.money(r, "aging90")];
        const total = get.money(r, "balance");
        const hasBuckets = b.some((x) => x != null);
        const buckets = (hasBuckets ? b.map((x) => x ?? 0) : [total ?? 0, 0, 0, 0]) as BalanceRec["buckets"];
        const sum = Math.round(buckets.reduce((s, x) => s + x, 0) * 100) / 100;
        if (hasBuckets && total != null && Math.abs(sum - total) > 0.01) issue(r, "warning", `Aging columns add up to ${sum.toFixed(2)} but the total says ${total.toFixed(2)}; using the aging columns`, "balance");
        if (sum < 0) { issue(r, "warning", `Credit balance (${sum.toFixed(2)}) isn't imported; record it as a credit on the lease`, "balance"); continue; }
        if (sum === 0) continue;
        if (buckets.some((x) => x < 0)) { issue(r, "error", "An aging column is negative; enter credits separately", "balance"); continue; }
        const prior = balances.findIndex((b) => b.property === p.key && b.unit === number);
        const rec = { property: p.key, unit: number, tenant: raw(r, "tenant") || undefined, buckets, src: { file: f.id, line: r.line } };
        // An aging report's buckets replace a rent roll's undated past-due figure for the same unit.
        if (prior < 0) balances.push(rec);
        else if (files.find((x) => x.id === balances[prior]!.src.file)?.kind === "rent_roll") balances[prior] = rec;
        else issue(r, "warning", `Unit ${number} already has a balance on row ${balances[prior]!.src.line}; skipped`);
        continue;
      }

      if (f.kind === "recurring") {
        const amount = get.money(r, "chargeAmount");
        if (!code) { issue(r, "error", "No charge name", "chargeCode"); continue; }
        if (amount == null) { issue(r, "error", "No charge amount", "chargeAmount"); continue; }
        if (amount <= 0) { issue(r, "error", `Charge amount ${amount} must be more than zero`, "chargeAmount"); continue; }
        const fq = raw(r, "frequency");
        const frequency = fq ? FREQ[fq.toLowerCase().replace(/[^a-z]/g, "")] : "Monthly";
        if (!frequency) { issue(r, "error", `Frequency "${fq}" isn't monthly, quarterly, annually or weekly`, "frequency"); continue; }
        const start = get.date(r, "chargeStart"), end = get.date(r, "chargeEnd");
        if (start && end && end < start) { issue(r, "error", "Charge ends before it starts", "chargeEnd"); continue; }
        recurring.push({ property: p.key, unit: number, label: code, amount, frequency, start, end, src: { file: f.id, line: r.line } });
        continue;
      }

      // Rent roll row.
      const st = raw(r, "leaseStatus");
      const rs = N.residentStatus(st);
      const list = rs === "vacant" ? [] : personFrom(r);
      let rent = get.money(r, "rent");
      const amount = code ? get.money(r, "chargeAmount") : undefined;
      if (rent == null && amount != null && N.isRentCode(code)) rent = amount;
      const marketRent = get.money(r, "marketRent");
      const sqft = get.int(r, "sqft");
      if (!list.length) {
        ensureUnit(p, number, r, { sqft, marketRent: marketRent ?? rent, status: N.unitStatus(st) ?? "Vacant" });
        lease = null;
        vacantContext = true;
        continue;
      }
      vacantContext = false;
      const start = get.date(r, "leaseStart") ?? get.date(r, "moveIn");
      const end = get.date(r, "leaseEnd");
      const status = start ? N.leaseStatus(st, start, end ?? null, today) : "Active";
      const k = `${p.key}|${number}`;
      const prev = seen.get(k);
      if (prev && prev.sig === sig) { issue(r, "warning", `Exact copy of row ${prev.line}; skipped`); lease = null; vacantContext = true; continue; }
      if (prev && prev.active && ACTIVE.has(status)) { issue(r, "error", `Unit ${number} already has a current lease on row ${prev.line}. Exclude one of the two rows.`, "unit"); lease = null; vacantContext = true; continue; }
      seen.set(k, { line: r.line, sig, active: ACTIVE.has(status) || !!prev?.active });
      if (!start) { issue(r, "error", "No lease start or move-in date", "leaseStart"); lease = null; vacantContext = true; continue; }
      if (end && end < start) { issue(r, "error", `Lease ends (${end}) before it starts (${start})`, "leaseEnd"); lease = null; vacantContext = true; continue; }
      if (!end) issue(r, "warning", "No lease end date: imported as month-to-month", "leaseEnd");
      const people = list.map((x, i) => ({ first: x.first, last: x.last, ...(i === 0 ? { email: get.email(r), phone: get.phone(r) } : {}) }));
      ensureUnit(p, number, r, { sqft, marketRent, status: status === "Future" ? "Vacant" : status === "Notice" ? "Notice" : "Occupied" });
      const deposit = get.money(r, "deposit");
      lease = { property: p.key, unit: number, people, start, end, moveIn: get.date(r, "moveIn"), moveOut: get.date(r, "moveOut"), rent: rent ?? 0, deposit: deposit && deposit > 0 ? deposit : undefined, status, externalId: raw(r, "leaseId") || undefined, src: { file: f.id, line: r.line } };
      leases.push(lease);
      rents.push({ lease, src: lease.src });
      if (code && amount != null && !N.isRentCode(code) && amount > 0) recurring.push({ property: p.key, unit: number, label: code, amount, frequency: "Monthly", start, end, src: { file: f.id, line: r.line } });
      const due = get.money(r, "balance");
      if (due && due > 0) balances.push({ property: p.key, unit: number, tenant: people[0] && `${people[0].first} ${people[0].last}`.trim(), buckets: [due, 0, 0, 0], src: { file: f.id, line: r.line } });
      if (due && due > 0) count("Balances without an age counted as 0–30 days");
    }
  }

  // Rent is checked once a lease's charge rows are all read (Yardi lists rent as a charge row).
  for (const { lease, src } of rents) {
    if (!lease.rent || lease.rent <= 0) issues.push({ ...src, severity: "error", message: lease.rent < 0 ? "Rent is negative" : "No rent amount", field: "rent" });
  }
  const valid = (s: Src) => !issues.some((i) => i.severity === "error" && i.file === s.file && i.line === s.line);
  const okLeases = leases.filter((l) => valid(l.src));
  outliers(okLeases, issues);

  // Residents also listed on the rent roll: their directory contact details join the lease's person.
  const byUnit = new Map(okLeases.map((l) => [`${l.property}|${l.unit}`, l]));
  const extra = residents.filter((res) => {
    const l = res.unit ? byUnit.get(`${res.property}|${res.unit}`) : undefined;
    const hit = l?.people.find((x) => N.key(`${x.first} ${x.last}`) === N.key(`${res.first} ${res.last}`));
    if (!hit) return true;
    hit.email ??= res.email;
    hit.phone ??= res.phone;
    return false;
  });

  const payload: Payload = {
    properties: [...props.values()], units: [...units.values()].filter((x) => valid(x.src)), residents: extra.filter((x) => valid(x.src)), leases: okLeases,
    owners: [...owners.values()].filter((x) => valid(x.src)), vendors: [...vendors.values()].filter((x) => valid(x.src)),
    balances: balances.filter((x) => valid(x.src)), recurring: recurring.filter((x) => valid(x.src)),
  };
  const used = new Set([...payload.units, ...payload.leases, ...payload.residents, ...payload.balances, ...payload.recurring].map((x) => x.property));
  payload.properties = payload.properties.filter((p) => used.has(p.key) || files.some((f) => f.id === p.src.file && f.kind === "properties"));
  return { payload, issues, suggestions: ruleSuggestions(files, edits, issues), cleanup, rows: rowsIn };
}

// Rent far from the file's median is usually a typo (an extra digit) or a commercial unit.
function outliers(leases: LeaseRec[], issues: Issue[]) {
  if (leases.length < 5) return;
  const sorted = leases.map((l) => l.rent).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  for (const l of leases) {
    if (l.rent > median * 3) issues.push({ ...l.src, severity: "warning", message: `Rent ${l.rent.toFixed(2)} is more than 3× the file's median (${median.toFixed(2)}); check for a typo`, field: "rent" });
    else if (l.rent < median / 4) issues.push({ ...l.src, severity: "warning", message: `Rent ${l.rent.toFixed(2)} is under a quarter of the file's median (${median.toFixed(2)}); check for a typo`, field: "rent" });
  }
}

const NAME_FIELDS: FieldKey[] = ["tenant", "firstName", "lastName", "ownerName", "contactName"];

// Fixes code can propose but a person should accept: ALL-CAPS names and swapped date columns.
export function ruleSuggestions(files: ImportFile[], edits: Edit[], issues: Issue[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const f of files) {
    for (const field of NAME_FIELDS) {
      const m = f.mapping[field];
      if (!m || !KIND_SPECS[f.kind].fields.includes(field)) continue;
      const counts = new Map<string, number>();
      for (const r of f.sheet.rows) {
        const v = r.cells[m.col]?.trim() ?? "";
        if (v && N.oddCase(v) && !/^vacant/i.test(v) && !edits.some((e) => e.file === f.id && e.field === field && e.from === v)) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      for (const [v, n] of [...counts].slice(0, 40)) out.push({ id: `rules:${f.id}:${field}:${v}`, file: f.id, field, kind: "replace", from: v, to: N.titleCase(v), reason: v === v.toUpperCase() ? "Name is in all capitals" : "Name is all lower case", confidence: 0.75, source: "rules", rows: n });
    }
    const flipped = issues.filter((i) => i.file === f.id && i.field === "leaseEnd" && /before it starts/.test(i.message)).length;
    if (f.mapping.leaseStart && f.mapping.leaseEnd && flipped >= 2 && flipped >= f.sheet.rows.length * 0.5) {
      out.push({ id: `rules:${f.id}:swap`, file: f.id, field: "leaseStart", other: "leaseEnd", kind: "swap", reason: `In ${flipped} rows the lease ends before it starts: the two date columns look swapped`, confidence: 0.85, source: "rules", rows: flipped });
    }
  }
  return out;
}

// Applying an accepted suggestion: a value edit, an excluded row, or swapped columns.
export function applySuggestion(s: Suggestion, files: ImportFile[], edits: Edit[]): { files: ImportFile[]; edits: Edit[] } {
  if (s.kind === "replace" && s.from != null && s.to != null) return { files, edits: [...edits.filter((e) => !(e.file === s.file && e.field === s.field && e.from === s.from && e.line === s.line)), { file: s.file, field: s.field, from: s.from, to: s.to, line: s.line }] };
  if (s.kind === "exclude" && s.line != null) return { edits, files: files.map((f) => (f.id === s.file ? { ...f, excluded: [...new Set([...f.excluded, s.line!])] } : f)) };
  if (s.kind === "swap" && s.other) {
    return { edits, files: files.map((f) => {
      if (f.id !== s.file) return f;
      const a = f.mapping[s.field], b = f.mapping[s.other!];
      return a && b ? { ...f, mapping: { ...f.mapping, [s.field]: { ...b, source: "manual" as const }, [s.other!]: { ...a, source: "manual" as const } } } : f;
    }) };
  }
  return { files, edits };
}

export const counts = (p: Payload) => Object.fromEntries(RECORD_TYPES.map((t) => [t, p[t].length])) as Record<RecordType, number>;
