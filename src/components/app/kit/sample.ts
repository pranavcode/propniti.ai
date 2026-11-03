import roster from "@/seed/roster.json";
import type { DataColumn, Facet, Row, StatusTabs } from "../data-table/types";

// Deterministic sample units for the /app/_kit style guide. The kit page filters, sorts and pages
// them on the server exactly as the list API would, so the DataTable runs end to end.

type P = { id: string; name: string; metro: string; neighborhood: string; type: string; units: number };
const props = (roster as P[]).filter((p) => /multifamily|garden|townhome|high-rise|mid-rise/i.test(p.type)).slice(0, 12);

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;

const FIRST = ["Jordan", "Maya", "Diego", "Aisha", "Ethan", "Sofia", "Liam", "Priya", "Noah", "Hannah", "José", "Zoë", "Marcus", "Chloe", "Omar", "Grace", "Lucas", "Nguyễn", "Ava", "Samuel"];
const LAST = ["Lee", "Patel", "Hernández", "Okafor", "Nguyen", "Brooks", "Kim", "Ramirez", "Johnson", "Ødegaard", "Núñez", "Carter", "Singh", "Thompson", "Alvarez", "Moore", "Chen", "Walker"];
const STATUS = ["Occupied", "Occupied", "Occupied", "Occupied", "Occupied", "Occupied", "Occupied", "Notice", "Vacant", "Down"] as const;

export const SAMPLE_UNITS: Row[] = props.flatMap((p, pi) => Array.from({ length: 34 + (pi % 4) * 3 }, (_, i) => {
  const beds = pick([0, 1, 1, 1, 2, 2, 3]);
  const status = pick(STATUS);
  const floor = 1 + Math.floor(i / 10);
  const rent = Math.round((1150 + beds * 420 + rnd() * 380 + (p.metro === "Austin" ? 140 : 0)) / 5) * 5;
  const occupied = status === "Occupied" || status === "Notice";
  const balance = occupied && rnd() < 0.14 ? Math.round(rent * (0.4 + rnd() * 2.2) * 100) / 100 : 0;
  const endOffset = Math.floor(rnd() * 330) - 20;
  const end = new Date(2026, 10, 4 + endOffset);
  const issues = rnd() < 0.06 ? 1 + Math.floor(rnd() * 2) : 0;
  return {
    id: `${p.id}-${floor}${String((i % 10) + 1).padStart(2, "0")}`,
    unit: `Unit ${floor}${String((i % 10) + 1).padStart(2, "0")}`,
    _subtitle: `${p.name} · ${p.neighborhood}`,
    _image: `/img/props/${p.id}-400.webp`,
    property_id: p.id,
    property_id__label: p.name,
    metro: p.metro,
    beds,
    sqft: 480 + beds * 310 + Math.round(rnd() * 120),
    status,
    resident: occupied ? `${pick(FIRST)} ${pick(LAST)}` : null,
    rent,
    balance,
    lease_end: occupied ? end.toISOString().slice(0, 10) : null,
    health: issues,
  };
}));

export const UNIT_COLUMNS: DataColumn[] = [
  { key: "unit", label: "Unit", primary: true, thumbnail: true },
  { key: "status", label: "Status", kind: "enum", enum: [{ value: "Occupied", tone: "success" }, { value: "Notice", tone: "warning" }, { value: "Vacant", tone: "neutral" }, { value: "Down", tone: "danger" }] },
  { key: "resident", label: "Resident" },
  { key: "property_id", label: "Property", kind: "ref", href: "/app/properties/{property_id}", defaultHidden: true },
  { key: "beds", label: "Beds", kind: "number", width: 70 },
  { key: "sqft", label: "Sq ft", kind: "number", width: 80 },
  { key: "rent", label: "Market rent", kind: "money", width: 120 },
  { key: "balance", label: "Balance", kind: "money", width: 120 },
  { key: "lease_end", label: "Lease end", kind: "due", width: 120 },
  { key: "health", label: "Data", kind: "health", width: 64, sortable: false },
];

export const UNIT_TABS: StatusTabs = { field: "status", options: UNIT_COLUMNS[1]!.enum! };

export const UNIT_FACETS: Facet[] = [
  { key: "metro", label: "Metro", kind: "enum", options: ["Austin", "Dallas", "Atlanta", "Phoenix"].map((m) => ({ value: m, count: SAMPLE_UNITS.filter((u) => u.metro === m).length })).filter((o) => o.count) },
  { key: "property_id", label: "Property", kind: "ref", options: props.map((p) => ({ value: p.id, label: p.name, count: SAMPLE_UNITS.filter((u) => u.property_id === p.id).length })) },
  { key: "beds", label: "Beds", kind: "enum", options: [0, 1, 2, 3].map((b) => ({ value: String(b), label: b ? `${b} bed` : "Studio" })) },
  { key: "rent", label: "Rent", kind: "money" },
  { key: "lease_end", label: "Lease end", kind: "date" },
];

export function queryUnits(sp: Record<string, string | string[] | undefined>) {
  const get = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  let rows = SAMPLE_UNITS;
  const q = get("q")?.toLowerCase();
  if (q) rows = rows.filter((r) => [r.unit, r.resident, r.property_id__label, r._subtitle].some((v) => String(v ?? "").toLowerCase().includes(q)));
  for (const k of Object.keys(sp)) {
    if (!k.startsWith("f.") || !get(k)) continue;
    const key = k.slice(2);
    const v = get(k)!;
    if (key.endsWith(".min") || key.endsWith(".max")) {
      const field = key.slice(0, -4);
      rows = rows.filter((r) => r[field] != null && (key.endsWith(".min") ? String(r[field]) >= v || Number(r[field]) >= Number(v) : String(r[field]) <= v || Number(r[field]) <= Number(v)));
    } else if (key !== "status") {
      const vals = v.split(",");
      rows = rows.filter((r) => vals.includes(String(r[key])));
    }
  }
  const counts: Record<string, number> = {};
  for (const r of rows) counts[String(r.status)] = (counts[String(r.status)] ?? 0) + 1;
  const status = get("f.status");
  if (status) rows = rows.filter((r) => status.split(",").includes(String(r.status)));
  const sort = get("sort");
  if (sort) {
    const desc = sort.startsWith("-");
    const key = desc ? sort.slice(1) : sort;
    rows = [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
      return desc ? -c : c;
    });
  }
  const size = Math.min(200, Number(get("size")) || 25);
  const page = Math.max(1, Number(get("page")) || 1);
  const total = rows.length;
  const sum = (k: string) => Math.round(rows.reduce((a, r) => a + Number(r[k] ?? 0), 0) * 100) / 100;
  return { rows: rows.slice((page - 1) * size, page * size), total, page, size, counts, footer: { "sum:rent": sum("rent"), "sum:balance": sum("balance") } };
}
