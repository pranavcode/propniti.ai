"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowRightLeft, Check, CircleAlert, FileUp, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AIBadge } from "@/components/app/ai/AIBadge";
import { StatusBadge } from "@/components/app/display";
import { useSetupProgress } from "@/components/app/onboarding/SetupChecklist";
import { apiJson, recordUrl } from "@/components/app/forms/api";
import { formatMoney, plural } from "@/lib/format";
import { applyMapping, FIELD_LABELS, guessMapping, IMPORT_FIELDS, parseCsv, parseDate, parseMoney, REQUIRED, validateRows, widthProblems, type ImportField, type ImportRow, type Mapping } from "@/lib/importer";

// Rent-roll import (port of the v1 onboarding importer onto v2 properties and units):
// source → map columns (AI) → review values → preview → import through the generic API.

export type ImportOptions = {
  canCreateProperties: boolean;
  canCreateUnits: boolean;
  portfolios: { id: string; name: string; owner_entity_id: string; owner: string }[];
  regions: { id: string; name: string; states: string[] }[];
  existing: { id: string; name: string; street: string }[];
};

const SAMPLE = `Property Name,Property Address,Unit #,Resident,Email,Phone,Monthly Rent,Lease From,Lease To,Owner
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",101,Maria Gonzalez,maria.gonzalez@example.com,(512) 555-0141,"$1,385.00",2027-02-28,2026-03-01,Bluebonnet Residential Fund II
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",102,Derek Wu,derek.wu@example.com,(512) 555-0187,"$1,410.00",2027-05-31,2026-06-01,Bluebonnet Residential Fund II
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",103,,,,"$1,395.00",,,Bluebonnet Residential Fund II
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",201,Aisha Patel,aisha.patel@example,(512) 555-0122,"$1,520.00",2027-01-31,2026-02-01,Bluebonnet Residential Fund II
Eastside Commons,"2105 E Cesar Chavez St, Austin, TX 78702",202,Tom Becker,tom.becker@example.com,(512) 555-0199,TBD,2026-12-31,2026-01-01,Bluebonnet Residential Fund II
Hyde Park Flats,"4310 Avenue B, Austin, TX 78751",A1,Sofia Ramirez,sofia.r@example.com,(512) 555-0110,"$1,180.00",2027-07-31,2026-08-01,Bluebonnet Residential Fund II
Hyde Park Flats,"4310 Avenue B, Austin, TX 78751",A2,Kevin O'Neill,kevin.oneill@example.com,(512) 555-0156,"$1,215.00",2027-04-30,2025-05-01,Bluebonnet Residential Fund II
Hyde Park Flats,"4310 Avenue B, Austin, TX 78751",,Priya Nair,priya.nair@example.com,(512) 555-0173,"$1,240.00",2027-09-30,2026-10-01,Bluebonnet Residential Fund II
Hyde Park Flats,"4310 Avenue B, Austin, TX 78751",B1,Marcus Lee,marcus.lee@example.com,(512) 555-0164,"$1,260.00",2027-03-31,2026-04-01,Bluebonnet Residential Fund II
The Lofts at Riverside,"1500 S Pleasant Valley Rd, Austin, TX 78741",412,Jordan Lee,jordan.lee@example.com,(512) 555-0102,"$1,650.00",2027-06-30,2026-07-01,Bluebonnet Residential Fund II
The Lofts at Riverside,"1500 S Pleasant Valley Rd, Austin, TX 78741",9901,Hannah Brooks,hannah.brooks@example.com,(512) 555-0135,"$1,595.00",2027-08-31,2026-09-01,Bluebonnet Residential Fund II
`;

const STEPS = ["Source", "Map columns", "Review values", "Preview", "Import"] as const;
const PROPERTY_TYPES = ["Garden multifamily", "Mid-rise multifamily", "High-rise multifamily", "Townhomes", "Small residential", "Mixed-use"];
const METROS: Record<string, string> = { austin: "Austin", dallas: "Dallas", atlanta: "Atlanta", phoenix: "Phoenix" };

// Units can be vacant, so a resident isn't required here (the v1 importer created tenancies).
const REQ: ImportField[] = REQUIRED.filter((f) => f !== "tenant");

const norm = (s?: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const ADDRESS = /^(.+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/;
const parseAddress = (a?: string) => {
  const m = a?.trim().match(ADDRESS);
  return m ? { street: m[1]!, city: m[2]!, state: m[3]!, zip: m[4]! } : null;
};

// Share of sample values that look right for the field: drives the confidence shown per column.
function validity(field: ImportField, values: string[]) {
  const vals = values.filter(Boolean);
  if (!vals.length) return 0;
  const ok: Record<ImportField, (v: string) => boolean> = {
    property: (v) => /[a-z]/i.test(v) && !parseDate(v),
    address: (v) => /\d/.test(v) && /[a-z]/i.test(v),
    unit: (v) => v.length <= 8,
    tenant: (v) => /^[a-z' .-]+$/i.test(v),
    email: (v) => v.includes("@"),
    phone: (v) => v.replace(/\D/g, "").length >= 10,
    rent: (v) => Number.isFinite(parseMoney(v)) && parseMoney(v) > 0,
    leaseStart: (v) => !!parseDate(v),
    leaseEnd: (v) => !!parseDate(v),
    owner: (v) => /[a-z]/i.test(v),
  };
  return vals.filter(ok[field]).length / vals.length;
}

type Plan = {
  properties: { key: string; name: string; existingId?: string; address: ReturnType<typeof parseAddress>; units: { row: ImportRow; existingId?: string; currentRent?: number }[] }[];
  skipped: number;
};

type Progress = { done: number; total: number; errors: string[]; created: { properties: number; units: number; updated: number } };

export function ImportWizard({ options }: { options: ImportOptions }) {
  const { setDone } = useSetupProgress();
  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [ai, setAi] = useState<{ source: string; note?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [portfolioId, setPortfolioId] = useState(options.portfolios[0]?.id ?? "");
  const [propType, setPropType] = useState(PROPERTY_TYPES[0]!);
  const [progress, setProgress] = useState<Progress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const headers = useMemo(() => table?.[0] ?? [], [table]);
  const guess = useMemo(() => guessMapping(headers), [headers]);
  const rows = useMemo(() => (table ? applyMapping(table, mapping) : []), [table, mapping]);
  const checks = useMemo(() => validateRows(rows).map((c) => {
    const vacant = !c.row.tenant?.trim();
    const errors = c.errors.filter((e) => e !== `${FIELD_LABELS.tenant} is missing`);
    if (vacant) c.warnings = c.warnings.filter((w) => !w.startsWith("No lease end"));
    if (c.row.address && !parseAddress(c.row.address)) c.warnings.push(`Address "${c.row.address}" isn't "street, city, ST 12345"`);
    return { ...c, errors };
  }), [rows]);
  const swapped = useMemo(() => {
    const both = rows.filter((r) => parseDate(r.leaseStart) && parseDate(r.leaseEnd));
    return both.length >= 2 && both.filter((r) => parseDate(r.leaseEnd)! <= parseDate(r.leaseStart)!).length / both.length >= 0.6;
  }, [rows]);
  const sample = (h: string | null | undefined) => (h ? (table ?? []).slice(1, 21).map((r) => r[headers.indexOf(h)] ?? "") : []);

  async function readSource(raw: string, name: string | null) {
    setParseError(null);
    try {
      const t = parseCsv(raw);
      if (t.length < 2) throw new Error("The file needs a header row and at least one data row.");
      if (t.length > 2001) throw new Error("Import up to 2,000 rows at a time; split larger files.");
      const width = widthProblems(t);
      if (width.length) throw new Error(`${width[0]}. Check the export for missing or extra commas.`);
      setTable(t);
      setFileName(name);
      setBusy(true);
      try {
        const r = await apiJson<{ mapping: Mapping; source: string; note?: string }>("POST", "/api/ai/import-map", { headers: t[0]!.slice(0, 60), samples: t.slice(1, 6).map((r) => r.slice(0, 60)) });
        setMapping(r.mapping);
        setAi({ source: r.source, note: r.note });
      } catch (e) {
        setMapping(guessMapping(t[0]!));
        setAi({ source: "mock", note: `Column matching by name only: ${(e as Error).message}` });
      } finally {
        setBusy(false);
      }
      setStep(1);
    } catch (e) {
      setParseError((e as Error).message);
    }
  }

  async function buildPlan() {
    setBusy(true);
    const valid = checks.filter((c) => !c.errors.length).map((c) => c.row);
    const groups = new Map<string, Plan["properties"][number]>();
    for (const row of valid) {
      const key = norm(row.property);
      const g = groups.get(key) ?? (() => {
        const addr = parseAddress(row.address);
        const hit = options.existing.find((p) => norm(p.name) === key || (addr && norm(p.street) === norm(addr.street)));
        const created = { key, name: row.property!.trim(), existingId: hit?.id, address: addr, units: [] as Plan["properties"][number]["units"] };
        groups.set(key, created);
        return created;
      })();
      g.units.push({ row });
    }
    // Units already on file for matched properties: update their rent instead of duplicating.
    await Promise.all([...groups.values()].filter((g) => g.existingId).map(async (g) => {
      try {
        const numbers = [...new Set(g.units.map((u) => u.row.unit!.trim()))];
        const found: { id: string; number: string; market_rent: number | null }[] = [];
        for (let i = 0; i < numbers.length; i += 50) {
          const res = await apiJson<{ rows: typeof found }>("GET", `${recordUrl("units")}?f.property_id=${encodeURIComponent(g.existingId!)}&f.number=${encodeURIComponent(numbers.slice(i, i + 50).join(","))}&size=100`);
          found.push(...res.rows);
        }
        const byNumber = new Map(found.map((u) => [norm(u.number), u]));
        for (const u of g.units) {
          const hit = byNumber.get(norm(u.row.unit));
          if (hit) Object.assign(u, { existingId: hit.id, currentRent: hit.market_rent ?? undefined });
        }
      } catch {
        // The preview still shows the property; units are treated as new and the API refuses duplicates.
      }
    }));
    setPlan({ properties: [...groups.values()], skipped: checks.length - valid.length });
    setBusy(false);
    setStep(3);
  }

  const counts = plan && {
    newProps: plan.properties.filter((p) => !p.existingId).length,
    newUnits: plan.properties.reduce((s, p) => s + p.units.filter((u) => !u.existingId).length, 0),
    updates: plan.properties.reduce((s, p) => s + p.units.filter((u) => u.existingId && u.currentRent !== parseMoney(u.row.rent)).length, 0),
    unchanged: plan.properties.reduce((s, p) => s + p.units.filter((u) => u.existingId && u.currentRent === parseMoney(u.row.rent)).length, 0),
  };
  const portfolio = options.portfolios.find((p) => p.id === portfolioId);
  const blocked = !!counts && ((counts.newProps > 0 && !options.canCreateProperties) || (counts.newUnits + counts.updates > 0 && !options.canCreateUnits));

  async function runImport() {
    if (!plan || !counts) return;
    setStep(4);
    const total = counts.newProps + counts.newUnits + counts.updates;
    const p: Progress = { done: 0, total, errors: [], created: { properties: 0, units: 0, updated: 0 } };
    const tick = () => setProgress({ ...p, errors: [...p.errors], created: { ...p.created } });
    tick();
    for (const g of plan.properties) {
      let propertyId = g.existingId;
      if (!propertyId) {
        const a = g.address;
        const region = options.regions.find((r) => a && r.states.includes(a.state));
        try {
          const r = await apiJson<{ row: { id: string } }>("POST", recordUrl("properties"), {
            name: g.name, type: propType, metro: METROS[norm(a?.city)] ?? "Austin", street: a?.street ?? "", city: a?.city ?? "", state: a?.state ?? "", zip: a?.zip ?? "",
            region_id: region?.id ?? options.regions[0]?.id, portfolio_id: portfolio?.id, owner_entity_id: portfolio?.owner_entity_id, org_id: "org-summit", unit_count: g.units.length,
          });
          propertyId = r.row.id;
          p.created.properties++;
        } catch (e) {
          p.errors.push(`${g.name}: ${(e as Error).message}. Its ${g.units.length} units were skipped.`);
          p.done += 1 + g.units.length;
          tick();
          continue;
        }
        p.done++;
        tick();
      }
      // Small batches keep under the write rate limit and show steady progress.
      for (let i = 0; i < g.units.length; i += 4) {
        await Promise.all(g.units.slice(i, i + 4).map(async (u) => {
          const rent = parseMoney(u.row.rent);
          try {
            if (!u.existingId) {
              await apiJson("POST", recordUrl("units"), { number: u.row.unit!.trim(), property_id: propertyId, market_rent: rent, status: u.row.tenant ? "Occupied" : "Vacant" });
              p.created.units++;
              p.done++;
            } else if (u.currentRent !== rent) {
              await apiJson("PATCH", recordUrl("units", u.existingId), { market_rent: rent });
              p.created.updated++;
              p.done++;
            }
          } catch (e) {
            p.errors.push(`${g.name} #${u.row.unit}: ${(e as Error).message}`);
            p.done++;
          }
        }));
        tick();
      }
    }
    p.done = total;
    tick();
    if (p.created.properties + p.created.units + p.created.updated > 0) { setDone("import", true); void apiJson("POST", "/api/ai/events", { type: "import.completed", payload: { properties: p.created.properties, units: p.created.units } }).catch(() => {}); }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums", i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-primary text-primary" : "text-muted-foreground")}>{i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
            <span className={cn(i === step ? "font-medium" : "text-muted-foreground")} aria-current={i === step ? "step" : undefined}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await readSource(await f.text(), f.name); e.target.value = ""; }} />
              <Button onClick={() => fileRef.current?.click()} disabled={busy}><FileUp /> Upload CSV</Button>
              <Button variant="outline" onClick={() => setText(SAMPLE)} disabled={busy}>Load a sample rent roll</Button>
              <span className="text-[12px] text-muted-foreground">or paste rows below (comma or tab separated, header row first)</span>
            </div>
            <Textarea name="rent-roll" aria-label="Paste a rent roll" value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder="Property Name,Property Address,Unit #,Resident,Monthly Rent,Lease From,Lease To…" className="font-mono text-[12px]" />
            {parseError && <p className="flex items-start gap-1.5 text-[12.5px] text-tone-danger" role="alert"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{parseError}</p>}
            <div className="flex justify-end">
              <Button onClick={() => readSource(text, null)} disabled={!text.trim() || busy}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Match columns</Button>
            </div>
          </div>
          <aside className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4 text-[12.5px] text-muted-foreground">
            <h2 className="text-[13px] font-semibold text-foreground">What gets imported</h2>
            <p>Properties (name and address) and their units with market rent. Units with a resident are marked occupied.</p>
            <p>Rows that match a property and unit already on file update the unit&apos;s rent instead of creating a duplicate.</p>
            <p>Resident and lease columns are checked here so problems surface early; leases themselves are set up from Leases, with deposits and charges.</p>
            <p>Files stay in your browser until you confirm the preview. Up to 2,000 rows per file.</p>
          </aside>
        </div>
      )}

      {step === 1 && table && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <span>{fileName ?? "Pasted data"} · {table.length - 1} rows · {headers.length} columns</span>
            {ai && <AIBadge source={ai.source === "mock" ? "rules" : "live"} model={ai.source === "mock" ? undefined : ai.source} />}
            {ai?.note && <span>{ai.note}</span>}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Propniti field</th><th className="px-3 py-2 font-medium">Column in your file</th><th className="px-3 py-2 font-medium">Confidence</th><th className="px-3 py-2 font-medium">Sample values</th></tr>
              </thead>
              <tbody>
                {IMPORT_FIELDS.map((f) => {
                  const h = mapping[f] ?? null;
                  const v = validity(f, sample(h));
                  const conf = h ? Math.round((guess[f] === h ? 0.97 : 0.86) * (0.35 + 0.65 * v) * 100) : null;
                  return (
                    <tr key={f} className="border-t">
                      <td className="px-3 py-1.5 font-medium">{FIELD_LABELS[f]}{REQ.includes(f) && <span className="ml-1 text-tone-danger" aria-label="required">*</span>}</td>
                      <td className="px-3 py-1.5">
                        <select aria-label={`Column for ${FIELD_LABELS[f]}`} value={h ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || null }))} className="h-8 w-56 rounded-md border bg-background px-2 text-[13px]">
                          <option value="">Not in this file</option>
                          {headers.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{conf == null ? <span className="text-muted-foreground">—</span> : <StatusBadge value={`${conf}%`} tone={conf >= 85 ? "success" : conf >= 60 ? "warning" : "danger"} />}</td>
                      <td className="max-w-[340px] truncate px-3 py-1.5 text-muted-foreground">{sample(h).slice(0, 3).filter(Boolean).join(" · ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft /> Back</Button>
            <Button onClick={() => setStep(2)} disabled={REQ.some((f) => !mapping[f])}>Review values <ArrowRight /></Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          {swapped && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-tone-ai/30 bg-tone-ai/[0.05] px-4 py-3">
              <Sparkles className="size-4 text-tone-ai" />
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="font-medium">Lease start and lease end look swapped</div>
                <div className="text-[12.5px] text-muted-foreground">In most rows the &quot;{mapping.leaseStart}&quot; date comes after &quot;{mapping.leaseEnd}&quot;. Swapping the two columns fixes every one of those rows.</div>
              </div>
              <Button size="sm" onClick={() => setMapping((m) => ({ ...m, leaseStart: m.leaseEnd, leaseEnd: m.leaseStart }))}><ArrowRightLeft /> Swap columns</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <StatusBadge value={`${checks.filter((c) => !c.errors.length).length} ready`} tone="success" />
            <StatusBadge value={`${checks.filter((c) => c.errors.length).length} with errors (skipped)`} tone={checks.some((c) => c.errors.length) ? "danger" : "neutral"} />
            <StatusBadge value={`${checks.filter((c) => !c.errors.length && c.warnings.length).length} with warnings`} tone="warning" />
          </div>
          <div className="max-h-[520px] overflow-auto rounded-lg border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Property</th><th className="px-3 py-2 font-medium">Unit</th><th className="px-3 py-2 font-medium">Resident</th><th className="px-3 py-2 text-right font-medium">Rent</th><th className="px-3 py-2 font-medium">Lease</th><th className="px-3 py-2 font-medium">Checks</th></tr>
              </thead>
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i} className={cn("border-t align-top", c.errors.length && "bg-tone-danger/[0.04]")}>
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{i + 2}</td>
                    <td className="px-3 py-1.5">{c.row.property ?? "—"}</td>
                    <td className="px-3 py-1.5">{c.row.unit ?? <span className="text-tone-danger">missing</span>}</td>
                    <td className="px-3 py-1.5">{c.row.tenant ?? <span className="text-muted-foreground">Vacant</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number.isFinite(parseMoney(c.row.rent)) ? formatMoney(parseMoney(c.row.rent)) : c.row.rent ?? "—"}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">{c.row.leaseStart ?? "—"} → {c.row.leaseEnd ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {!c.errors.length && !c.warnings.length && <span className="inline-flex items-center gap-1 text-tone-success"><Check className="size-3.5" /> OK</span>}
                      {c.errors.map((e) => <div key={e} className="flex items-start gap-1 text-tone-danger"><CircleAlert className="mt-0.5 size-3 shrink-0" />{e}</div>)}
                      {c.warnings.map((w) => <div key={w} className="flex items-start gap-1 text-tone-warning"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{w}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft /> Back</Button>
            <Button onClick={buildPlan} disabled={busy || !checks.some((c) => !c.errors.length)}>{busy ? <Loader2 className="animate-spin" /> : null} Preview import <ArrowRight /></Button>
          </div>
        </div>
      )}

      {step === 3 && plan && counts && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[["Properties to create", counts.newProps], ["Units to create", counts.newUnits], ["Units to update", counts.updates], ["Rows skipped", plan.skipped + counts.unchanged]].map(([l, v]) => (
              <div key={l} className="rounded-lg border bg-card p-3.5"><div className="text-[12px] text-muted-foreground">{l}</div><div className="mt-1 text-[22px] font-semibold tabular-nums">{v}</div></div>
            ))}
          </div>
          {counts.newProps > 0 && (
            <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Owner and portfolio for new properties
                <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} className="h-8 w-80 rounded-md border bg-background px-2 text-[13px] text-foreground">
                  {options.portfolios.map((p) => <option key={p.id} value={p.id}>{p.owner} · {p.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Property type
                <select value={propType} onChange={(e) => setPropType(e.target.value)} className="h-8 w-56 rounded-md border bg-background px-2 text-[13px] text-foreground">
                  {PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <p className="text-[12px] text-muted-foreground">Region comes from each address&apos;s state.</p>
            </div>
          )}
          <ul className="divide-y rounded-lg border bg-card">
            {plan.properties.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{g.existingId ? <Link href={`/app/properties/${g.existingId}`} className="hover:text-primary hover:underline">{g.name}</Link> : g.name}</div>
                  <div className="text-[12px] text-muted-foreground">{g.address ? `${g.address.street}, ${g.address.city}, ${g.address.state} ${g.address.zip}` : "No address in the file"}</div>
                </div>
                <StatusBadge value={g.existingId ? "Already on file" : "New property"} tone={g.existingId ? "info" : "success"} />
                <span className="w-56 text-right text-[12.5px] text-muted-foreground tabular-nums">
                  {g.units.filter((u) => !u.existingId).length} new units · {g.units.filter((u) => u.existingId && u.currentRent !== parseMoney(u.row.rent)).length} rent updates
                </span>
              </li>
            ))}
          </ul>
          {blocked && <p className="flex items-start gap-1.5 rounded-lg border border-tone-warning/30 bg-tone-warning/[0.06] px-4 py-3 text-[12.5px]" role="status"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tone-warning" />Your role can review this import but not write it: new properties need a principal or regional manager, and units need a property manager or above. Switch role from your avatar menu to finish.</p>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft /> Back</Button>
            <Button onClick={runImport} disabled={blocked || counts.newProps + counts.newUnits + counts.updates === 0}>Import {counts.newProps + counts.newUnits + counts.updates} changes</Button>
          </div>
        </div>
      )}

      {step === 4 && progress && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium">{progress.done < progress.total ? "Importing…" : progress.errors.length ? "Import finished with errors" : "Import complete"}</span>
            <span className="text-muted-foreground tabular-nums">{progress.done} of {progress.total}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total} aria-label="Import progress">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
          </div>
          <p className="text-[12.5px] text-muted-foreground">{plural(progress.created.properties, "property", "properties")} created · {plural(progress.created.units, "unit")} created · {plural(progress.created.updated, "rent")} updated</p>
          {progress.errors.length > 0 && <ul className="flex flex-col gap-1 text-[12.5px] text-tone-danger">{progress.errors.slice(0, 20).map((e) => <li key={e} className="flex items-start gap-1.5"><CircleAlert className="mt-0.5 size-3 shrink-0" />{e}</li>)}</ul>}
          {progress.done >= progress.total && (
            <div className="flex gap-2">
              <Button asChild><Link href="/app/properties">Open properties</Link></Button>
              <Button variant="outline" onClick={() => { setStep(0); setTable(null); setPlan(null); setProgress(null); setText(""); }}>Import another file</Button>
              <Button asChild variant="ghost"><Link href="/app/setup">Back to setup</Link></Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
