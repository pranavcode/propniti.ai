"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSetupProgress } from "@/components/app/onboarding/SetupChecklist";
import { apiJson } from "@/components/app/forms/api";
import type { AiResult, AiMapping } from "../ai";
import { buildAiRequest } from "../airequest";
import { assemble, applySuggestion, type Assembled, type Edit, type ImportFile, type Suggestion } from "../assemble";
import { PRESETS, type ToolKey } from "../presets";
import type { ImportResult, ImportTable, PlanSummary, RecentImport } from "../server";
import { MapStep, ReviewStep } from "./MapReview";
import { PreviewStep, ResultStep } from "./PreviewResult";
import { SourceStep, UploadStep } from "./SourceUpload";

// The import flow: source tool → files → columns → issues and fixes → preview → import → result.
// Files are parsed and checked here in the browser; the model (when on) sees only what
// buildAiRequest sends; the server gets the cleaned records at preview and import.

export type WizardOptions = {
  today: string;
  allowed: Record<ImportTable, boolean>;
  portfolios: { id: string; name: string; owner: string }[];
  ai: { available: boolean; label: string; model: string; centsPer1kIn: number; centsPer1kOut: number };
  recent: RecentImport[];
};
export type Preview = { batch: string; summary: PlanSummary; skipped: { type: string; label: string; reason: string; line?: string }[]; matched: { type: string; label: string; href: string }[]; samples: Record<ImportTable, { label: string; detail: string }[]>; notes: string[] };

const STEPS = ["Source", "Files", "Columns", "Review", "Preview", "Done"] as const;

// The optional AI pass on the files; any failure falls back to rules only and says so.
export async function importSuggestions(files: ImportFile[], assembled: Assembled): Promise<AiResult> {
  try {
    return await apiJson<AiResult>("POST", "/api/import/ai", buildAiRequest(files, assembled));
  } catch (e) {
    return { live: false, source: "Rules", model: "rules", note: `AI suggestions unavailable (${(e as Error).message}); rules only.`, estimate: { tokensIn: 0, tokensOut: 0, costCents: 0 }, mappings: [], suggestions: [], notes: [] };
  }
}

// start: files already read and identified elsewhere (onboarding), opened at the Columns step.
export type WizardStart = { tool: ToolKey; files: ImportFile[]; aiOn: boolean; ai: AiResult | null };

export function ImportWizard({ options, start, onImported }: { options: WizardOptions; start?: WizardStart; onImported?: (r: ImportResult) => void }) {
  const { setDone } = useSetupProgress();
  const [step, setStep] = useState(start ? 2 : 0);
  const [tool, setTool] = useState<ToolKey | null>(start?.tool ?? null);
  const [autoSamples, setAutoSamples] = useState(false);
  const [aiOn, setAiOn] = useState(start?.aiOn ?? options.ai.available);
  const [files, setFiles] = useState<ImportFile[]>(start?.files ?? []);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [decided, setDecided] = useState<Record<string, "accepted" | "dismissed">>({});
  const [ai, setAi] = useState<AiResult | null>(start?.ai ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [recent, setRecent] = useState(options.recent);
  const [settings, setSettings] = useState({ portfolioId: options.portfolios[0]?.id ?? "", propertyType: "Garden multifamily" });

  const assembled = useMemo(() => assemble(files, edits, options.today), [files, edits, options.today]);
  const suggestions = useMemo(() => [...assembled.suggestions, ...(ai?.suggestions ?? [])].filter((s) => !decided[s.id]), [assembled.suggestions, ai, decided]);
  const aiMappings = useMemo(() => (ai?.mappings ?? []).filter((m) => !decided[`map:${m.file}:${m.field}`] && !files.find((f) => f.id === m.file)?.mapping[m.field]), [ai, decided, files]);

  const accept = (list: Suggestion[]) => {
    let state = { files, edits };
    for (const s of list) state = applySuggestion(s, state.files, state.edits);
    setFiles(state.files);
    setEdits(state.edits);
    setDecided((d) => ({ ...d, ...Object.fromEntries(list.map((s) => [s.id, "accepted" as const])) }));
  };
  const dismiss = (id: string) => setDecided((d) => ({ ...d, [id]: "dismissed" }));
  const acceptMappings = (list: AiMapping[]) => {
    setFiles((fs) => fs.map((f) => {
      const mine = list.filter((m) => m.file === f.id && !Object.values(f.mapping).some((x) => x?.col === m.col));
      return mine.length ? { ...f, mapping: { ...f.mapping, ...Object.fromEntries(mine.map((m) => [m.field, { col: m.col, source: "ai" as const, confidence: m.confidence, reason: m.reason }])) } } : f;
    }));
    setDecided((d) => ({ ...d, ...Object.fromEntries(list.map((m) => [`map:${m.file}:${m.field}`, "accepted" as const])) }));
  };

  const options$ = () => ({
    tool: tool ?? "generic",
    reports: [...new Set(files.map((f) => PRESETS.find((p) => p.id === f.preset)?.report).filter((x): x is string => !!x))].slice(0, 10),
    files: files.map((f) => f.name.slice(0, 120)),
    portfolioId: settings.portfolioId || undefined,
    propertyType: settings.propertyType,
    ...(ai?.live ? { ai: { model: ai.model, suggestions: ai.suggestions.length + ai.mappings.length, accepted: Object.entries(decided).filter(([k, v]) => v === "accepted" && (k.startsWith("ai:") || k.startsWith("map:"))).length } } : {}),
  });

  async function toColumns() {
    setError(null);
    if (aiOn && !ai) {
      setBusy("Asking the model for suggestions (up to a minute)…");
      setAi(await importSuggestions(files, assembled));
      setBusy(null);
    }
    setStep(2);
  }

  async function toPreview() {
    setError(null);
    setBusy("Checking against your data…");
    try {
      setPreview(await apiJson<Preview>("POST", "/api/import", { mode: "preview", payload: assembled.payload, options: options$() }));
      setStep(4);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setError(null);
    setBusy("Importing…");
    try {
      const r = await apiJson<ImportResult>("POST", "/api/import", { mode: "commit", payload: assembled.payload, options: options$() });
      setResult(r);
      setRecent((list) => [{ batch: r.batch, at: "", actor: "You", detail: `Imported ${Object.values(r.created).reduce((s, n) => s + (n ?? 0), 0)} records`, undone: false, created: r.created }, ...list]);
      setDone("import", true);
      onImported?.(r);
      setStep(5);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function undo(batch: string) {
    setError(null);
    setBusy("Undoing the import…");
    try {
      await apiJson("POST", "/api/import/undo", { batch });
      setRecent((list) => list.map((x) => (x.batch === batch && !x.undone ? { ...x, undone: true } : x)));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const reset = () => { setStep(0); setFiles([]); setEdits([]); setDecided({}); setAi(null); setPreview(null); setResult(null); setError(null); };

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums", i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-primary text-primary" : "text-muted-foreground")}>{i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
            <span className={cn(i === step ? "font-medium" : "text-muted-foreground", i !== step && "max-sm:hidden")} aria-current={i === step ? "step" : undefined}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-border sm:w-6" aria-hidden />}
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="rounded-md border border-tone-danger/30 bg-tone-danger/[0.05] px-3 py-2 text-[12.5px] text-tone-danger">{error}</p>}

      {step === 0 && <SourceStep tool={tool} setTool={setTool} recent={recent} onUndo={undo} busy={busy} onNext={() => setStep(1)} onSamples={(t) => { setTool(t); setFiles([]); setEdits([]); setDecided({}); setAi(null); setPreview(null); setAutoSamples(true); setStep(1); }} />}
      {step === 1 && tool && <UploadStep tool={tool} files={files} setFiles={setFiles} assembled={assembled} aiOn={aiOn} setAiOn={setAiOn} ai={options.ai} busy={busy} onBack={() => setStep(0)} onNext={toColumns} autoSamples={autoSamples} onAutoSamples={() => setAutoSamples(false)} />}
      {step === 2 && <MapStep files={files} setFiles={setFiles} ai={ai} aiMappings={aiMappings} acceptMappings={acceptMappings} dismiss={dismiss} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <ReviewStep files={files} setFiles={setFiles} assembled={assembled} suggestions={suggestions} ai={ai} accept={accept} dismiss={dismiss} busy={busy} onBack={() => setStep(2)} onNext={toPreview} />}
      {step === 4 && preview && <PreviewStep preview={preview} options={options} settings={settings} setSettings={setSettings} ai={ai} busy={busy} onBack={() => setStep(3)} onRefresh={toPreview} onImport={runImport} />}
      {step === 5 && result && <ResultStep result={result} busy={busy} onUndo={() => undo(result.batch)} undone={!!recent.find((r) => r.batch === result.batch)?.undone} onAgain={reset} />}
    </div>
  );
}
