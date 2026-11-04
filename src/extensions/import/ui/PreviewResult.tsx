"use client";

import Link from "@/components/Link";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/app/display";
import { formatNumber } from "@/lib/format";
import type { AiResult } from "../ai";
import { SHOWN, TYPE_LABEL as LABEL } from "../labels";
import type { ImportResult, ImportTable } from "../server";
import type { Preview, WizardOptions } from "./ImportWizard";
import { RulesBadge } from "./RulesBadge";

const PROPERTY_TYPES = ["Garden multifamily", "Mid-rise multifamily", "High-rise multifamily", "Townhomes", "Small residential", "Mixed-use", "Office", "Retail strip", "Industrial flex"];
const n = (t: ImportTable, k: number) => `${formatNumber(k)} ${LABEL[t][k === 1 ? 0 : 1]}`;
const list = (parts: string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

// The plain summary is built from the server's counts, never by the model.
export function summaryText(p: Preview) {
  const adds = SHOWN.filter((t) => p.summary[t].new).map((t) => n(t, p.summary[t].new));
  const existing = SHOWN.reduce((s, t) => s + p.summary[t].existing, 0);
  const skipped = SHOWN.reduce((s, t) => s + p.summary[t].skipped, 0);
  return [
    adds.length ? `This import adds ${list(adds)}.` : "Nothing new to add: every record is already on file.",
    existing ? `${formatNumber(existing)} ${existing === 1 ? "record is" : "records are"} already on file and won't be duplicated.` : "",
    skipped ? `${formatNumber(skipped)} ${skipped === 1 ? "record" : "records"} can't be imported (reasons below).` : "",
  ].filter(Boolean).join(" ");
}

export function PreviewStep({ preview, options, settings, setSettings, ai, busy, onBack, onRefresh, onImport }: {
  preview: Preview; options: WizardOptions; settings: { portfolioId: string; propertyType: string }; setSettings: (s: { portfolioId: string; propertyType: string }) => void;
  ai: AiResult | null; busy: string | null; onBack: () => void; onRefresh: () => void; onImport: () => void;
}) {
  const total = SHOWN.reduce((s, t) => s + preview.summary[t].new, 0) + preview.summary.households.new + preview.summary.portfolios.new;
  const shown = SHOWN.filter((t) => preview.summary[t].new + preview.summary[t].existing + preview.summary[t].skipped > 0);
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-lg border bg-card p-4">
        <p className="text-[13.5px]" data-testid="import-summary">{summaryText(preview)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground"><RulesBadge /> Counts computed by the app against your workspace{ai?.live ? "; the model's suggestions only changed values you accepted" : ""}.</p>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {shown.map((t) => (
          <div key={t} className="rounded-lg border bg-card p-3.5" data-testid={`count-${t}`}>
            <div className="text-[12px] text-muted-foreground">{LABEL[t][1].replace(/^./, (c) => c.toUpperCase())}</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{formatNumber(preview.summary[t].new)} <span className="text-[12px] font-normal text-muted-foreground">new</span></div>
            <div className="text-[12px] text-muted-foreground tabular-nums">{formatNumber(preview.summary[t].existing)} on file · {formatNumber(preview.summary[t].skipped)} skipped</div>
          </div>
        ))}
      </div>

      {preview.summary.properties.new > 0 && (
        <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
          <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Portfolio for new properties without a known owner
            <select value={settings.portfolioId} onChange={(e) => setSettings({ ...settings, portfolioId: e.target.value })} className="h-8 w-80 max-w-full rounded-md border bg-background px-2 text-[13px] text-foreground">
              {options.portfolios.map((p) => <option key={p.id} value={p.id}>{p.owner} · {p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Property type when the file has none
            <select value={settings.propertyType} onChange={(e) => setSettings({ ...settings, propertyType: e.target.value })} className="h-8 w-56 rounded-md border bg-background px-2 text-[13px] text-foreground">
              {PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={!!busy}><RefreshCw /> Update preview</Button>
          <p className="text-[12px] text-muted-foreground">Region comes from each address&apos;s state.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {shown.filter((t) => preview.samples[t].length).map((t) => (
          <section key={t} className="rounded-lg border bg-card">
            <h3 className="border-b px-4 py-2 text-[12.5px] font-semibold">First {LABEL[t][1]} to add</h3>
            <ul className="divide-y">{preview.samples[t].map((s, i) => <li key={i} className="flex flex-wrap justify-between gap-x-3 px-4 py-1.5 text-[12.5px]"><span className="font-medium">{s.label}</span><span className="text-muted-foreground">{s.detail}</span></li>)}</ul>
          </section>
        ))}
      </div>

      {(preview.notes.length > 0 || preview.skipped.length > 0) && (
        <section className="flex flex-col gap-1.5 rounded-lg border border-tone-warning/30 bg-tone-warning/[0.05] p-3 text-[12.5px]">
          {preview.notes.map((x) => <p key={x} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-tone-warning" />{x}</p>)}
          {preview.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">{formatNumber(preview.skipped.length)} records can&apos;t be imported</summary>
              <ul className="mt-1 flex flex-col gap-0.5">{preview.skipped.slice(0, 100).map((s, i) => <li key={i}><span className="font-medium">{s.label}</span> · {s.reason}</li>)}</ul>
            </details>
          )}
        </section>
      )}
      {preview.matched.length > 0 && (
        <details className="rounded-lg border bg-card p-3 text-[12.5px]">
          <summary className="cursor-pointer font-medium">{formatNumber(preview.matched.length)} already on file (kept as they are)</summary>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">{preview.matched.slice(0, 60).map((m, i) => <li key={i}><Link href={m.href} className="text-primary hover:underline">{m.label}</Link></li>)}</ul>
        </details>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onBack}><ArrowLeft /> Back</Button>
        <Button onClick={onImport} disabled={!total || !!busy}>{busy ? <><Loader2 className="animate-spin" />{busy}</> : `Import ${formatNumber(total)} records`}</Button>
      </div>
    </div>
  );
}

export function ResultStep({ result, busy, undone, onUndo, onAgain }: { result: ImportResult; busy: string | null; undone: boolean; onUndo: () => Promise<boolean>; onAgain: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const created = (Object.keys(result.created) as ImportTable[]).filter((t) => result.created[t]);
  const total = created.reduce((s, t) => s + (result.created[t] ?? 0), 0);
  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        {undone ? <StatusBadge value="Import undone" tone="neutral" /> : <span className="flex size-7 items-center justify-center rounded-full bg-tone-success/10 text-tone-success"><Check className="size-4" /></span>}
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">{undone ? "The records from this import were removed" : `Imported ${formatNumber(total)} records`}</h2>
          <p className="text-[12.5px] text-muted-foreground" data-testid="import-result">{list(created.map((t) => n(t, result.created[t]!)))}. Logged in the audit trail as import {result.batch}.</p>
        </div>
        {!undone && <Button variant="outline" onClick={() => setConfirm(true)} disabled={!!busy}><Undo2 /> Undo import</Button>}
        <Button variant="ghost" onClick={onAgain}>Import more files</Button>
      </section>
      {!undone && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {created.filter((t) => result.links[t]?.length).map((t) => (
            <section key={t} className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <h3 className="text-[12.5px] font-semibold">{n(t, result.created[t]!)}</h3>
                {result.lists[t] && <Link href={result.lists[t]!} className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">Open list <ExternalLink className="size-3" /></Link>}
              </div>
              <ul className="divide-y">{result.links[t]!.map((l) => <li key={l.href} className="px-4 py-1.5 text-[12.5px]"><Link href={l.href} className="hover:text-primary hover:underline">{l.label}</Link></li>)}</ul>
            </section>
          ))}
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo this import?</DialogTitle>
            <DialogDescription>This removes the {formatNumber(total)} records the import created, including any edits made to them since. It is refused if payments, credits or work orders were added to them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep the import</Button>
            <Button variant="destructive" disabled={!!busy} onClick={async () => { await onUndo(); setConfirm(false); }}>{busy ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
