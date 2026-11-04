"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleAlert, Loader2, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AIBadge, Confidence } from "@/components/app/ai/AIBadge";
import { StatusBadge } from "@/components/app/display";
import { formatNumber, plural } from "@/lib/format";
import type { AiMapping, AiResult } from "../ai";
import type { Assembled, ImportFile, Suggestion } from "../assemble";
import { FIELDS, KIND_SPECS, type FieldKey } from "../fields";
import { missingRequired, type MatchSource } from "../mapping";
import { RulesBadge } from "./RulesBadge";

type SetFiles = (f: ImportFile[] | ((f: ImportFile[]) => ImportFile[])) => void;
const SOURCE: Record<MatchSource, string> = { preset: "Preset", synonym: "Usual name", similar: "Similar name", ai: "AI, accepted", manual: "You" };
const required = (f: ImportFile) => new Set(KIND_SPECS[f.kind].required.flatMap((r) => (Array.isArray(r) ? [] : [r])));

function FileTabs({ files, current, setCurrent, badge }: { files: ImportFile[]; current: string; setCurrent: (id: string) => void; badge?: (f: ImportFile) => React.ReactNode }) {
  if (files.length < 2) return null;
  return (
    <div role="tablist" aria-label="Files" className="flex flex-wrap gap-1 border-b">
      {files.map((f) => (
        <button key={f.id} role="tab" aria-selected={f.id === current} onClick={() => setCurrent(f.id)}
          className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px]", f.id === current ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {f.name}{badge?.(f)}
        </button>
      ))}
    </div>
  );
}

function AiSource({ ai }: { ai: AiResult | null }) {
  if (!ai) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
      {ai.live ? <AIBadge source="live" model={ai.model} /> : <RulesBadge />}
      {ai.live ? (ai.usage ? `${formatNumber(ai.usage.tokensIn)} tokens in, ${formatNumber(ai.usage.tokensOut)} out · ${ai.usage.costCents > 0 ? `${ai.usage.costCents.toFixed(2)}¢` : "cost not tracked"} · ${(ai.usage.latencyMs / 1000).toFixed(1)} s` : "") : (ai.note ?? "Rules")}
    </span>
  );
}

export function MapStep({ files, setFiles, ai, aiMappings, acceptMappings, dismiss, onBack, onNext }: {
  files: ImportFile[]; setFiles: SetFiles; ai: AiResult | null; aiMappings: AiMapping[]; acceptMappings: (m: AiMapping[]) => void; dismiss: (id: string) => void; onBack: () => void; onNext: () => void;
}) {
  const [current, setCurrent] = useState(files[0]?.id ?? "");
  const f = files.find((x) => x.id === current) ?? files[0]!;
  const sectioned = f.sheet.rows.some((r) => r.section);
  const missing = (x: ImportFile) => missingRequired(x.kind, x.mapping, !!x.defaultProperty || x.sheet.rows.some((r) => r.section));
  const used = new Set(Object.values(f.mapping).map((m) => m!.col));
  const unused = f.sheet.headers.filter((_, i) => !used.has(i));
  const pending = aiMappings.filter((m) => m.file === f.id);
  const setCol = (field: FieldKey, col: string) => setFiles((fs) => fs.map((x) => {
    if (x.id !== f.id) return x;
    const mapping = { ...x.mapping };
    if (col === "") delete mapping[field];
    else {
      const c = Number(col);
      for (const k of Object.keys(mapping) as FieldKey[]) if (mapping[k]!.col === c) delete mapping[k];
      mapping[field] = { col: c, source: "manual", confidence: 1, reason: "Chosen by you" };
    }
    return { ...x, mapping };
  }));
  const samples = (col?: number) => (col == null ? [] : f.sheet.rows.slice(0, 40).map((r) => r.cells[col] ?? "").filter(Boolean).slice(0, 3));
  const req = required(f);
  const alt = KIND_SPECS[f.kind].required.filter(Array.isArray).flat();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted-foreground">Check each match. Change any column with its menu; required fields are marked *.</p>
        <AiSource ai={ai} />
      </div>
      <FileTabs files={files} current={f.id} setCurrent={setCurrent} badge={(x) => (missing(x).length ? <CircleAlert className="size-3.5 text-tone-warning" aria-label="needs columns" /> : null)} />

      {aiMappings.length > 0 && (
        <section aria-label="AI column suggestions" className="flex flex-col gap-2 rounded-lg border border-tone-ai/30 bg-tone-ai/[0.04] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px] font-medium"><AIBadge source="live" model={ai?.model} /> Suggested column matches</div>
            <Button size="sm" onClick={() => acceptMappings(aiMappings)}><Check /> Accept all {aiMappings.length}</Button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {pending.map((m) => (
              <li key={`${m.file}:${m.field}`} className="flex flex-col gap-1.5 text-[12.5px] sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div><span className="font-medium">&quot;{f.sheet.headers[m.col]}&quot;</span> → {FIELDS[m.field].label}</div>
                  <div className="flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground"><Confidence value={m.confidence} /><span>{m.reason}</span></div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => acceptMappings([m])}><Check /> Accept</Button>
                  <Button size="sm" variant="ghost" aria-label="Dismiss suggestion" onClick={() => dismiss(`map:${m.file}:${m.field}`)}><X /></Button>
                </div>
              </li>
            ))}
            {!pending.length && <li className="text-[12px] text-muted-foreground">No suggestions for this file; see the other tabs.</li>}
          </ul>
        </section>
      )}

      {KIND_SPECS[f.kind].fields.includes("property") && !f.mapping.property && (
        <label className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3 text-[12.5px]">
          <span className="font-medium">This file has no property column.</span>
          <span className="text-muted-foreground">{sectioned ? "Property headings in the file are used; or name one property for every row:" : "Name the property every row belongs to:"}</span>
          <Input aria-label="Property for every row" value={f.defaultProperty ?? ""} placeholder="e.g. Maple Court Apartments" className="h-8 w-64"
            onChange={(e) => setFiles((fs) => fs.map((x) => (x.id === f.id ? { ...x, defaultProperty: e.target.value || undefined } : x)))} />
        </label>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Propniti field</th><th className="px-3 py-2 font-medium">Column in {f.name}</th><th className="px-3 py-2 font-medium">Matched by</th><th className="px-3 py-2 font-medium">Sample values</th></tr>
          </thead>
          <tbody>
            {KIND_SPECS[f.kind].fields.map((field) => {
              const m = f.mapping[field];
              return (
                <tr key={field} className="border-t">
                  <td className="px-3 py-1.5 font-medium">{FIELDS[field].label}{req.has(field) && <span className="ml-1 text-tone-danger" aria-label="required">*</span>}{alt.includes(field) && <span className="ml-1 text-muted-foreground" title="One of these is required">†</span>}</td>
                  <td className="px-3 py-1.5">
                    <select aria-label={`Column for ${FIELDS[field].label}`} value={m ? String(m.col) : ""} onChange={(e) => setCol(field, e.target.value)} className="h-8 w-56 rounded-md border bg-background px-2 text-[13px]">
                      <option value="">Not in this file</option>
                      {f.sheet.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">{m ? <span className="inline-flex items-center gap-2" title={m.reason}>{m.source === "ai" ? <AIBadge source="live" size="xs" /> : <StatusBadge value={SOURCE[m.source]} tone={m.source === "similar" ? "warning" : "neutral"} dot={false} />}<span className="text-[12px] text-muted-foreground tabular-nums">{Math.round(m.confidence * 100)}%</span></span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="max-w-[320px] truncate px-3 py-1.5 text-muted-foreground">{samples(m?.col).join(" · ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">{alt.length > 0 && "† One of these is required. "}{unused.length ? `Not imported: ${unused.join(", ")}.` : "Every column is used."}</p>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button>
        <Button onClick={onNext} disabled={files.some((x) => missing(x).length > 0)}>{files.find((x) => missing(x).length) ? `Map ${missing(files.find((x) => missing(x).length)!).join(", ")} in ${files.find((x) => missing(x).length)!.name}` : <>Review values <ArrowRight /></>}</Button>
      </div>
    </div>
  );
}

function SuggestionRow({ s, file, accept, dismiss }: { s: Suggestion; file?: ImportFile; accept: (s: Suggestion[]) => void; dismiss: (id: string) => void }) {
  const what = s.kind === "swap" ? `Swap ${FIELDS[s.field].label} and ${FIELDS[s.other!].label}` : s.kind === "exclude" ? `Leave out row ${s.line}${s.from ? ` ("${s.from}")` : ""}` : `${FIELDS[s.field].label}: "${s.from}" → "${s.to}"${s.line ? ` on row ${s.line}` : s.rows > 1 ? ` (${s.rows} rows)` : ""}`;
  return (
    <li className="flex flex-col gap-1.5 py-2 text-[12.5px] sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {s.source === "ai" ? <AIBadge source="live" size="xs" /> : <RulesBadge />}
          <span className="font-medium">{what}</span>
          {file && <span className="text-muted-foreground">{file.name}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground"><Confidence value={s.confidence} /><span>{s.reason}</span></div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="outline" onClick={() => accept([s])}><Check /> Accept</Button>
        <Button size="sm" variant="ghost" aria-label="Dismiss suggestion" onClick={() => dismiss(s.id)}><X /></Button>
      </div>
    </li>
  );
}

export function ReviewStep({ files, setFiles, assembled, suggestions, ai, accept, dismiss, busy, onBack, onNext }: {
  files: ImportFile[]; setFiles: SetFiles; assembled: Assembled; suggestions: Suggestion[]; ai: AiResult | null;
  accept: (s: Suggestion[]) => void; dismiss: (id: string) => void; busy: string | null; onBack: () => void; onNext: () => void;
}) {
  const [current, setCurrent] = useState(files[0]?.id ?? "");
  const f = files.find((x) => x.id === current) ?? files[0]!;
  const issues = assembled.issues;
  const errors = issues.filter((i) => i.severity === "error");
  const errLines = (fid: string) => [...new Set(errors.filter((i) => i.file === fid).map((i) => i.line))];
  const mine = issues.filter((i) => i.file === f.id);
  const byLine = new Map<number, typeof mine>();
  for (const i of mine) byLine.set(i.line, [...(byLine.get(i.line) ?? []), i]);
  const lines = [...byLine.keys()].sort((a, b) => a - b);
  const cleanup = Object.entries(assembled.cleanup[f.id] ?? {});
  const exclude = (fid: string, ls: number[]) => setFiles((fs) => fs.map((x) => (x.id === fid ? { ...x, excluded: [...new Set([...x.excluded, ...ls])] } : x)));
  const restore = (fid: string) => setFiles((fs) => fs.map((x) => (x.id === fid ? { ...x, excluded: [] } : x)));
  const show = (cells: string[]) => f.sheet.headers.map((h, i) => (cells[i] ? `${h}: ${cells[i]}` : "")).filter(Boolean).slice(0, 5).join(" · ");
  const rows = Object.values(assembled.rows).reduce((s, n) => s + n, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <StatusBadge value={`${formatNumber(rows)} rows read`} tone="neutral" />
        <StatusBadge value={plural(errors.length, "error")} tone={errors.length ? "danger" : "success"} />
        <StatusBadge value={plural(issues.length - errors.length, "warning")} tone="warning" />
        {files.some((x) => x.excluded.length) && <StatusBadge value={`${files.reduce((s, x) => s + x.excluded.length, 0)} rows left out`} tone="neutral" />}
        <span className="text-muted-foreground">Errors must be fixed or left out before importing; warnings are imported as noted.</span>
      </div>

      {suggestions.length > 0 && (
        <section aria-label="Suggested fixes" className="flex flex-col rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">Suggested fixes <span className="font-normal text-muted-foreground">· nothing changes until you accept</span></h2>
            <Button size="sm" onClick={() => accept(suggestions)}><Wand2 /> Accept all {suggestions.length}</Button>
          </div>
          <ul className="divide-y">{suggestions.slice(0, 60).map((s) => <SuggestionRow key={s.id} s={s} file={files.length > 1 ? files.find((x) => x.id === s.file) : undefined} accept={accept} dismiss={dismiss} />)}</ul>
        </section>
      )}

      {ai?.notes.length ? (
        <section aria-label="AI notes" className="flex flex-col gap-1 rounded-lg border border-tone-ai/30 bg-tone-ai/[0.04] p-3 text-[12.5px]">
          <div className="flex items-center gap-2 font-medium"><AIBadge source="live" model={ai.model} /> What the model noticed</div>
          <ul className="list-disc pl-5">{ai.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="text-[11.5px] text-muted-foreground">Counts and totals on the next screen come from the app&apos;s own calculation, not the model.</p>
        </section>
      ) : null}

      <FileTabs files={files} current={f.id} setCurrent={setCurrent} badge={(x) => (errLines(x.id).length ? <span className="rounded bg-tone-danger/10 px-1 text-[11px] text-tone-danger tabular-nums">{errLines(x.id).length}</span> : null)} />

      {cleanup.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <RulesBadge /> Fixed by rules: {cleanup.map(([what, n]) => `${what} (${n})`).join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {errLines(f.id).length > 0 && <Button size="sm" variant="outline" onClick={() => exclude(f.id, errLines(f.id))}><X /> Leave out {plural(errLines(f.id).length, "row")} with errors</Button>}
        {f.excluded.length > 0 && <Button size="sm" variant="ghost" onClick={() => restore(f.id)}>Bring back {plural(f.excluded.length, "left-out row")}</Button>}
      </div>

      <div className="max-h-[520px] overflow-auto rounded-lg border">
        {lines.length === 0 ? <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-tone-success"><Check className="size-4" /> No problems in {f.name}.</p> : (
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-muted text-left text-muted-foreground"><tr><th className="w-14 px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium max-sm:hidden">Values</th><th className="px-3 py-2 font-medium">Checks</th><th className="w-24 px-3 py-2"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {lines.map((line) => {
                const list = byLine.get(line)!;
                const row = f.sheet.rows.find((r) => r.line === line);
                const bad = list.some((i) => i.severity === "error");
                return (
                  <tr key={line} className={cn("border-t align-top", bad && "bg-tone-danger/[0.04]")}>
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{line}</td>
                    <td className="max-w-[420px] px-3 py-1.5 text-[12px] text-muted-foreground max-sm:hidden">{row ? show(row.cells) : ""}</td>
                    <td className="px-3 py-1.5">{list.map((i) => <div key={i.message} className={cn("flex items-start gap-1", i.severity === "error" ? "text-tone-danger" : "text-tone-warning")}>{i.severity === "error" ? <CircleAlert className="mt-0.5 size-3 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3 shrink-0" />}{i.message}</div>)}</td>
                    <td className="px-3 py-1.5 text-right">{bad && <Button size="sm" variant="ghost" onClick={() => exclude(f.id, [line])}>Leave out</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button>
        <Button onClick={onNext} disabled={errors.length > 0 || !!busy}>{busy ? <><Loader2 className="animate-spin" />{busy}</> : errors.length ? `Fix or leave out ${plural(errors.length, "error")}` : <>Preview import <ArrowRight /></>}</Button>
      </div>
    </div>
  );
}
