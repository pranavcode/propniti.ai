"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, FileSpreadsheet, FileUp, Loader2, Lock, Sparkles, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/app/display";
import { formatNumber } from "@/lib/format";
import { buildAiRequest, outTokens } from "../airequest";
import type { Assembled, ImportFile } from "../assemble";
import { KIND_SPECS, KINDS, type Kind } from "../fields";
import { detect, missingRequired, presetMapping, synonymMapping } from "../mapping";
import { MAX_FILES, MAX_ROWS, readTable, toSheet } from "../parse";
import { PRESETS, presetsFor, TOOLS, toolLabel, type ToolKey } from "../presets";
import type { RecentImport } from "../server";
import type { WizardOptions } from "./ImportWizard";

export function SourceStep({ tool, setTool, recent, onUndo, busy, onNext, onSamples }: { tool: ToolKey | null; setTool: (t: ToolKey) => void; recent: RecentImport[]; onUndo: (batch: string) => Promise<boolean>; busy: string | null; onNext: () => void; onSamples: (t: ToolKey) => void }) {
  const presets = tool ? presetsFor(tool) : [];
  // Sized by the space the wizard has, not the window, so the Ask panel can be open beside it.
  return (
    <div className="@container">
    <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-[14px] font-semibold">Where is your portfolio today?</h2>
          <p className="text-[12.5px] text-muted-foreground">Pick the tool you&apos;re moving from. Its usual export columns are matched for you; anything else can be matched by hand. No files handy? Each tool has sample files: choose <span className="font-medium text-foreground">Try samples</span>.</p>
        </div>
        <div role="radiogroup" aria-label="Source tool" className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
          {TOOLS.map((t) => (
            <div key={t.key} data-tool-tile className={cn("flex min-w-0 flex-col rounded-md border transition-colors", tool === t.key && "border-primary bg-primary/[0.06] ring-1 ring-primary")}>
              <button type="button" role="radio" aria-checked={tool === t.key} onClick={() => setTool(t.key)}
                className="flex min-h-14 flex-col items-start justify-center rounded-t-md px-3 pt-2 pb-1 text-left text-[13px] font-medium outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60">
                {t.label}
                <span className="text-[11.5px] font-normal text-muted-foreground">{presetsFor(t.key).length} {presetsFor(t.key).length === 1 ? "report" : "reports"} · samples available</span>
              </button>
              <button type="button" onClick={() => onSamples(t.key)} aria-label={`Try ${t.label} sample files`}
                className="flex items-center gap-1 rounded-b-md border-t px-3 py-1.5 text-left text-[12px] font-medium text-primary outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60">
                <FileSpreadsheet className="size-3.5 shrink-0" aria-hidden />Try samples
              </button>
            </div>
          ))}
        </div>
        {tool && (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
            <p className="text-[12.5px] text-muted-foreground">
              {tool === "generic"
                ? "Any CSV, TSV or Excel (.xlsx) file with a header row. Columns are matched by their names; check each match on the next screen."
                : <>Presets are based on the typical {toolLabel(tool)} report exports listed below. Exports change and can be customised, so check each match; unmatched columns can be mapped by hand.</>}
            </p>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-2">
              {presets.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span><span className="font-medium">{p.report}</span> <span className="text-muted-foreground">· {KIND_SPECS[p.kind].label.toLowerCase()}</span></span>
                  <a href={`/samples/${p.file}`} download className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"><Download className="size-3" aria-hidden />Sample</a>
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-muted-foreground">Sample files are synthetic test data, not real people or properties.</p>
          </div>
        )}
        <div className="flex justify-end"><Button onClick={onNext} disabled={!tool}>Continue <ArrowRight /></Button></div>
      </section>
      <aside className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-[12.5px] text-muted-foreground">
        <h2 className="text-[13px] font-semibold text-foreground">What can come over</h2>
        <p>Properties, units, residents, leases (from a rent roll), owners and owner entities, vendors, open balances by age, recurring charges and security deposits.</p>
        <p>Files are read on this device. Nothing is saved until you confirm the preview, and each import can be undone.</p>
        <p>Imports land in your private demo workspace, which resets at midnight Pacific.</p>
        {recent.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <h3 className="text-[12.5px] font-semibold text-foreground">Recent imports</h3>
            <ul className="flex flex-col gap-2">
              {recent.map((r, i) => (
                <li key={`${r.batch}-${i}`} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-foreground">{r.detail}</div>
                    <div className="text-[11.5px] tabular-nums">{r.actor} · {r.at ? r.at.slice(0, 16).replace("T", " ") : "just now"}</div>
                  </div>
                  {r.undone ? <StatusBadge value="Undone" tone="neutral" /> : <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onUndo(r.batch)}><Undo2 /> Undo</Button>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
    </div>
  );
}

let seq = 0;
export async function toFile(name: string, bytes: Uint8Array, tool?: ToolKey): Promise<ImportFile> {
  const sheet = toSheet(await readTable(name, bytes));
  if (!sheet.rows.length) throw new Error(`${name} has a header row but no data rows.`);
  if (sheet.rows.length > MAX_ROWS) throw new Error(`${name} has ${formatNumber(sheet.rows.length)} rows; import up to ${formatNumber(MAX_ROWS)} rows per file. Split it by property and import each part.`);
  const d = detect(sheet.headers, tool, sheet.rows.some((r) => r.section));
  return { id: `f${++seq}`, name, kind: d.kind, sheet, mapping: d.mapping, preset: d.preset?.id, excluded: [] };
}

export function UploadStep({ tool, files, setFiles, assembled, aiOn, setAiOn, ai, busy, onBack, onNext, autoSamples, onAutoSamples }: {
  tool: ToolKey; files: ImportFile[]; setFiles: (f: ImportFile[] | ((f: ImportFile[]) => ImportFile[])) => void; assembled: Assembled;
  aiOn: boolean; setAiOn: (v: boolean) => void; ai: WizardOptions["ai"]; busy: string | null; onBack: () => void; onNext: () => void;
  autoSamples?: boolean; onAutoSamples?: () => void;     // "Try samples" on the first step: load them on arrival
}) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const est = useMemo(() => {
    if (!files.length) return null;
    const req = buildAiRequest(files, assembled);
    const tokens = Math.ceil((JSON.stringify(req).length + 2500) / 4);
    return { tokens, cents: (tokens / 1000) * ai.centsPer1kIn + (outTokens(req.files) / 1000) * ai.centsPer1kOut };
  }, [files, assembled, ai]);

  async function add(list: { name: string; bytes: () => Promise<Uint8Array> }[]) {
    setReading(true);
    const errs: string[] = [];
    const out: ImportFile[] = [];
    for (const f of list.slice(0, Math.max(0, MAX_FILES - files.length))) {
      try { out.push(await toFile(f.name, await f.bytes(), tool)); } catch (e) { errs.push((e as Error).message); }
    }
    if (list.length > MAX_FILES - files.length) errs.push(`Up to ${MAX_FILES} files per import.`);
    setFiles((fs) => [...fs, ...out]);
    setErrors(errs);
    setReading(false);
  }
  const samples = (tool === "generic" ? PRESETS.filter((p) => p.tool === "generic") : presetsFor(tool).filter((p) => ["rent_roll", "residents", "balances"].includes(p.kind))).slice(0, 3);
  const loadSamples = () => add(samples.map((p) => ({ name: p.file, bytes: async () => new Uint8Array(await (await fetch(`/samples/${p.file}`)).arrayBuffer()) })));
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!autoSamples || autoLoaded.current) return;
    autoLoaded.current = true;
    onAutoSamples?.();
    void loadSamples();
  });
  const setKind = (id: string, kind: Kind) => setFiles((fs) => fs.map((f) => {
    if (f.id !== id) return f;
    const preset = PRESETS.find((p) => p.id === f.preset && p.kind === kind);
    return { ...f, kind, mapping: synonymMapping(f.sheet.headers, kind, preset ? presetMapping(f.sheet.headers, preset) : {}) };
  }));
  const ready = files.length > 0 && !reading;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void add([...e.dataTransfer.files].map((f) => ({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) }))); }}>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" multiple accept=".csv,.tsv,.txt,.xlsx,text/csv" className="hidden" aria-label="Choose export files"
            onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; void add(list.map((f) => ({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) }))); }} />
          <Button onClick={() => input.current?.click()} disabled={reading || files.length >= MAX_FILES}><FileUp /> Choose files</Button>
          <Button variant="outline" onClick={loadSamples} disabled={reading || files.length >= MAX_FILES}>{reading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Load {toolLabel(tool)} sample files</Button>
          <span className="text-[12px] text-muted-foreground">or drop files here · CSV, TSV or Excel (.xlsx) · up to {MAX_FILES} files, 3 MB and {formatNumber(MAX_ROWS)} rows each</span>
        </div>
        {errors.map((e) => <p key={e} role="alert" className="text-[12.5px] text-tone-danger">{e}</p>)}
        {files.length > 0 && (
          <ul className="divide-y rounded-md border">
            {files.map((f) => {
              const preset = PRESETS.find((p) => p.id === f.preset);
              const missing = missingRequired(f.kind, f.mapping, !!f.defaultProperty || f.sheet.rows.some((r) => r.section));
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-[13px]">
                  <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <div className="truncate font-medium">{f.name}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {formatNumber(f.sheet.rows.length)} rows · {f.sheet.headers.length} columns
                      {preset ? ` · matches the typical ${toolLabel(preset.tool)} ${preset.report} layout` : " · no preset matched; columns matched by name"}
                      {f.sheet.skipped.titles + f.sheet.skipped.totals > 0 && ` · skipped ${f.sheet.skipped.titles} title and ${f.sheet.skipped.totals} total rows`}
                      {f.sheet.skipped.sections > 0 && ` · ${f.sheet.skipped.sections} property headings used as property names`}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[12px] text-muted-foreground">Holds
                    <select aria-label={`Record type in ${f.name}`} value={f.kind} onChange={(e) => setKind(f.id, e.target.value as Kind)} className="h-8 rounded-md border bg-background px-2 text-[13px] text-foreground">
                      {KINDS.map((k) => <option key={k} value={k}>{KIND_SPECS[k].label}</option>)}
                    </select>
                  </label>
                  {missing.length ? <StatusBadge value={`Needs ${missing.join(", ")}`} tone="warning" /> : <StatusBadge value="Columns matched" tone="success" />}
                  <Button size="icon" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><X /></Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <Switch id="import-ai" checked={aiOn} onCheckedChange={setAiOn} aria-describedby="import-ai-help" />
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="import-ai" className="flex items-center gap-1.5 text-[13px] font-medium"><Sparkles className="size-3.5 text-tone-ai" aria-hidden />Use AI to help map and clean up</label>
            <p id="import-ai-help" className="text-[12.5px] text-muted-foreground">
              {ai.available ? `${ai.label} suggests column matches and fixes; you accept each one.` : "No AI model is configured here, so the server will answer with rules only."}{" "}
              Only column headers, the first 5 rows and up to 30 flagged cells per file are sent, each cell cut to 60 characters. Never the whole file. Parsing, checks, the preview and the import itself are done by code.
            </p>
            {aiOn && est && <p className="text-[12px] text-muted-foreground tabular-nums">Estimated: about {formatNumber(est.tokens)} tokens in{ai.centsPer1kIn > 0 ? `, roughly ${est.cents < 1 ? "under 1¢" : `${est.cents.toFixed(1)}¢`}` : ", cost not tracked for this model"}. Shared AI rate limit: 20 requests a minute.</p>}
          </div>
        </div>
        {!aiOn && <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="size-3" aria-hidden />Rules only: columns are matched by preset and name, values are checked by code, and nothing is sent to a model.</p>}
      </section>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button>
        <Button onClick={onNext} disabled={!ready || !!busy}>{busy ? <Loader2 className="animate-spin" /> : null}{busy ?? "Match columns"} {!busy && <ArrowRight />}</Button>
      </div>
    </div>
  );
}
