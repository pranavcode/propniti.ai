"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/Link";
import { Cpu, FileSpreadsheet, FileUp, Loader2, Lock, Sparkles, Upload, X } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AIBadge, Confidence } from "@/components/app/ai/AIBadge";
import { apiJson } from "@/components/app/forms/api";
import { assemble, type ImportFile } from "@/extensions/import/assemble";
import { KIND_SPECS, KINDS, type Kind } from "@/extensions/import/fields";
import { presetMapping, presetScore, synonymMapping } from "@/extensions/import/mapping";
import { MAX_FILES } from "@/extensions/import/parse";
import { PRESETS, TOOLS, toolLabel, type ToolKey } from "@/extensions/import/presets";
import { ImportWizard, importSuggestions, type WizardStart } from "@/extensions/import/ui/ImportWizard";
import { toFile } from "@/extensions/import/ui/SourceUpload";
import type { AiDetection, DetectResult } from "../ai";
import { detectFile, mainTool, type Detection } from "../detect";
import { ContinueButton, type StepProps } from "./Onboarding";

type Entry = { file: ImportFile; rules: Detection; ai?: AiDetection; tool: ToolKey; kind: Kind };

const SAMPLES = ["appfolio-rent-roll.csv", "appfolio-tenant-directory.csv", "buildium-vendors.csv"];
const LABELS: Record<string, [string, string]> = {
  properties: ["property", "properties"], units: ["unit", "units"], residents: ["resident", "residents"], leases: ["lease", "leases"],
  owners: ["owner", "owners"], owner_entities: ["owner entity", "owner entities"], vendors: ["vendor", "vendors"], deposits: ["deposit", "deposits"],
  recurring_charges: ["recurring charge", "recurring charges"], charges: ["opening balance", "opening balances"],
};
export const createdText = (c: Record<string, number>) => Object.entries(LABELS).filter(([t]) => c[t]).map(([t, [one, many]]) => `${formatNumber(c[t]!)} ${c[t] === 1 ? one : many}`).join(", ");

// The import file for the chosen tool and record type: that tool's best-fitting report preset,
// then column names, exactly as the import wizard matches them.
function finalFile(e: Entry): ImportFile {
  const headers = e.file.sheet.headers;
  const preset = PRESETS.filter((p) => p.tool === e.tool && p.kind === e.kind).map((p) => ({ p, s: presetScore(headers, p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.p;
  return { ...e.file, kind: e.kind, preset: preset?.id, mapping: synonymMapping(headers, e.kind, preset ? presetMapping(headers, preset) : {}) };
}

const detectBody = (es: Entry[]) => ({
  files: es.map((e) => ({
    id: e.file.id, name: e.file.name.slice(0, 120),
    headers: e.file.sheet.headers.slice(0, 60).map((h) => h.slice(0, 80)),
    samples: e.file.sheet.rows.slice(0, 3).map((r) => r.cells.slice(0, 60).map((c) => c.slice(0, 60))),
  })),
});

export function DataStep({ data, state, save, footer, complete }: StepProps) {
  const router = useRouter();
  const opts = data.options;
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"files" | "wizard" | "summary">(state.import ? "summary" : "files");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [aiOn, setAiOn] = useState(opts.ai.available);
  const [aiStatus, setAiStatus] = useState<Omit<DetectResult, "detections"> | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [start, setStart] = useState<WizardStart | null>(null);
  const [imported, setImported] = useState(!!state.import);

  async function add(list: { name: string; bytes: () => Promise<Uint8Array> }[]) {
    setReading("Reading files…");
    const errs: string[] = [];
    const fresh: Entry[] = [];
    const room = Math.max(0, MAX_FILES - entries.length);
    for (const f of list.slice(0, room)) {
      try {
        const file = await toFile(f.name, await f.bytes());
        const rules = detectFile({ id: file.id, name: file.name, headers: file.sheet.headers, hasSection: file.sheet.rows.some((r) => r.section) });
        fresh.push({ file, rules, tool: rules.tool, kind: rules.kind });
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
    if (list.length > room) errs.push(`Up to ${MAX_FILES} files at a time.`);
    if (aiOn && fresh.length) {
      setReading(`Asking ${opts.ai.label} to identify ${fresh.length === 1 ? "the file" : `${fresh.length} files`}…`);
      try {
        const r = await apiJson<DetectResult>("POST", "/api/onboarding/detect", detectBody(fresh));
        const { detections, ...status } = r;
        setAiStatus(status);
        for (const e of fresh) {
          const d = detections.find((x) => x.id === e.file.id);
          if (d) Object.assign(e, { ai: d, tool: d.tool, kind: d.kind });
        }
      } catch (e) {
        setAiStatus({ live: false, source: "Rules", model: "rules", note: `AI identification unavailable (${(e as Error).message}), so files were identified by their columns and names only.` });
      }
    }
    setEntries((xs) => [...xs, ...fresh]);
    setErrors(errs);
    setReading(null);
  }

  const fromInput = (files: File[]) => add(files.map((f) => ({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) })));
  const loadSamples = () => add(SAMPLES.map((name) => ({ name, bytes: async () => new Uint8Array(await (await fetch(`/samples/${name}`)).arrayBuffer()) })));
  const update = (id: string, patch: Partial<Pick<Entry, "tool" | "kind">>) => setEntries((xs) => xs.map((e) => (e.file.id === id ? { ...e, ...patch } : e)));

  async function handOff() {
    const files = entries.map(finalFile);
    let ai = null;
    if (aiOn) {
      setReading("Asking the model for column and value suggestions (up to a minute)…");
      ai = await importSuggestions(files, assemble(files, [], opts.today));
      setReading(null);
    }
    setStart({ tool: mainTool(entries), files, aiOn, ai });
    setPhase("wizard");
  }

  async function onImported(r: { batch: string; created: Record<string, number | undefined> }) {
    const created = Object.fromEntries(Object.entries(r.created).filter((x): x is [string, number] => typeof x[1] === "number"));
    const saved = await save({ import: { batch: r.batch, created, tool: start?.tool ?? "generic", ai: aiOn }, done: ["data"] });
    if (saved) setImported(true);
    // Suggested rules are sized from the import, so the server figures are read again.
    router.refresh();
  }

  if (phase === "summary" && state.import) {
    return (
      <>
        <div className="flex flex-col gap-3 px-4 py-5 sm:px-5">
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div className="text-[13px] font-medium">Imported from {toolLabel(state.import.tool)}</div>
            <div className="text-[12.5px] text-muted-foreground tabular-nums">{createdText(state.import.created) || "No new records"}{state.import.ai ? " · AI suggestions were on" : " · rules only"}</div>
          </div>
          <p className="text-[12.5px] text-muted-foreground">To remove these records, undo the import from <Link href="/app/settings/import" className="text-primary hover:underline">Settings › Import data</Link>.</p>
          <div><Button variant="outline" onClick={() => { setEntries([]); setPhase("files"); }}><Upload /> Import more files</Button></div>
        </div>
        {footer(<ContinueButton onClick={() => void complete()} />)}
      </>
    );
  }

  if (phase === "wizard" && start) {
    return (
      <>
        <div className="flex flex-col gap-3 px-4 py-5 sm:px-5">
          <p className="text-[12.5px] text-muted-foreground">Columns, value checks, preview, import and undo are the same steps as Settings › Import data. Nothing is written until you confirm the preview.</p>
          <ImportWizard options={opts} start={start} onImported={(r) => void onImported(r)} />
        </div>
        {footer(<ContinueButton onClick={() => void complete()} disabled={!imported}>{imported ? "Continue" : "Import to continue"}</ContinueButton>)}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-5">
        {!data.canImportProperties && <p className="rounded-md border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">Your role can add owners and vendors but not properties, units or leases. A principal or regional manager imports those, or skip this step.</p>}
        <div
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void fromInput([...e.dataTransfer.files]); }}
        >
          <FileUp className="size-6 text-muted-foreground" aria-hidden />
          <div>
            <div className="text-[13.5px] font-medium">Drop your exports here</div>
            <div className="text-[12.5px] text-muted-foreground">Rent rolls, tenant, owner and vendor lists, aging reports, from one tool or several · CSV, TSV or Excel · up to {MAX_FILES} files</div>
          </div>
          <input ref={input} type="file" multiple accept=".csv,.tsv,.txt,.xlsx,text/csv" className="hidden" aria-label="Choose export files"
            onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; void fromInput(list); }} />
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => input.current?.click()} disabled={!!reading || entries.length >= MAX_FILES}><FileUp /> Choose files</Button>
            <Button variant="outline" onClick={() => void loadSamples()} disabled={!!reading || entries.length + SAMPLES.length > MAX_FILES}><FileSpreadsheet /> Try sample files</Button>
          </div>
          <p className="text-[11.5px] text-muted-foreground">Sample files are synthetic test data from AppFolio and Buildium layouts, not real people or properties.</p>
        </div>

        <div className="flex items-start gap-3 rounded-md border px-3 py-3">
          <Switch id="onb-ai" checked={aiOn} onCheckedChange={setAiOn} aria-describedby="onb-ai-help" />
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="onb-ai" className="flex items-center gap-1.5 text-[13px] font-medium"><Sparkles className="size-3.5 text-tone-ai" aria-hidden />Use AI to identify files and suggest fixes</label>
            <p id="onb-ai-help" className="text-[12.5px] text-muted-foreground">
              {opts.ai.available ? `${opts.ai.label} names each file's tool and contents, then suggests column matches and fixes you accept one by one.` : "No AI model is configured here, so the server answers with rules only."}{" "}
              Only file names, header rows and the first rows of each file are sent (3 rows to identify, 5 for suggestions), each cell cut to 60 characters. Never the whole file.
            </p>
            {!aiOn && <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground"><Lock className="mt-0.5 size-3 shrink-0" aria-hidden />Rules only: files are identified by their columns and names, and nothing is sent to a model.</p>}
          </div>
        </div>

        {reading && <p role="status" className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden />{reading}</p>}
        {errors.map((e) => <p key={e} role="alert" className="text-[12.5px] text-tone-danger">{e}</p>)}
        {aiStatus?.note && <p className="text-[12.5px] text-muted-foreground">{aiStatus.note}</p>}

        {entries.length > 0 && (
          <section aria-labelledby="onb-files">
            <h3 id="onb-files" className="mb-2 text-[13px] font-semibold">{entries.length === 1 ? "1 file" : `${entries.length} files`} identified</h3>
            <ul className="divide-y rounded-md border">
              {entries.map((e) => {
                const viaAi = e.ai && e.ai.tool === e.tool && e.ai.kind === e.kind;
                const viaRules = !viaAi && e.rules.tool === e.tool && e.rules.kind === e.kind;
                const disagree = e.ai && (e.ai.tool !== e.rules.tool || e.ai.kind !== e.rules.kind);
                return (
                  <li key={e.file.id} className="flex flex-col gap-2 px-3 py-3 text-[13px]">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{e.file.name}</div>
                        <div className="text-[12px] text-muted-foreground tabular-nums">{formatNumber(e.file.sheet.rows.length)} rows · {e.file.sheet.headers.length} columns</div>
                      </div>
                      <Button size="icon" variant="ghost" aria-label={`Remove ${e.file.name}`} onClick={() => setEntries((xs) => xs.filter((x) => x.file.id !== e.file.id))}><X /></Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <span className="w-12 shrink-0">From</span>
                        <select aria-label={`Source tool of ${e.file.name}`} value={e.tool} onChange={(x) => update(e.file.id, { tool: x.target.value as ToolKey })} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-[13px] text-foreground">
                          {TOOLS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <span className="w-12 shrink-0">Holds</span>
                        <select aria-label={`Record type in ${e.file.name}`} value={e.kind} onChange={(x) => update(e.file.id, { kind: x.target.value as Kind })} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-[13px] text-foreground">
                          {KINDS.map((k) => <option key={k} value={k}>{KIND_SPECS[k].label}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground" data-testid="file-detection">
                      {viaAi ? <AIBadge source="live" model={aiStatus?.model} size="xs" /> : viaRules ? <span className="inline-flex h-[18px] items-center gap-1 rounded bg-muted px-1 text-[10.5px] font-medium ring-1 ring-border ring-inset"><Cpu className="size-3" aria-hidden />Rules</span> : <span className="text-[11.5px] font-medium text-foreground">Set by you</span>}
                      {(viaAi || viaRules) && <Confidence value={viaAi ? e.ai!.confidence : e.rules.confidence} />}
                    </div>
                    {(viaAi || viaRules) && <p className="text-[12px] text-muted-foreground">{viaAi ? e.ai!.reason : e.rules.reason}</p>}
                    {disagree && <p className="text-[12px] text-muted-foreground">Rules read it as {toolLabel(e.rules.tool)} · {KIND_SPECS[e.rules.kind].label.toLowerCase()}. <button type="button" className="text-primary hover:underline" onClick={() => update(e.file.id, { tool: e.rules.tool, kind: e.rules.kind })}>Use that</button></p>}
                    {!e.ai && e.rules.alternatives.length > 0 && <p className="text-[12px] text-tone-warning">Check the source: {e.rules.alternatives.map(toolLabel).join(" and ")} export{e.rules.alternatives.length === 1 ? "s" : ""} the same columns.</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {imported && <p className="text-[12.5px] text-muted-foreground">An import from this step is already done; anything you add now is a second import.</p>}
      </div>
      {footer(
        <Button onClick={() => void handOff()} disabled={!entries.length || !!reading}>
          {reading ? <Loader2 className="animate-spin" /> : null}Match columns
        </Button>,
      )}
    </>
  );
}
