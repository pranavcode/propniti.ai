"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CirclePlus, Loader2, Search, Sparkles, Undo2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd } from "../display";
import { TONE_DOT } from "../status";
import { readRange, readValues } from "./params";
import type { AiFilterFn, AiFilterResult, Facet, FacetOption } from "./types";

type Set = (patch: Record<string, string | null>) => void;

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setText(value); }
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { if (text !== value) onChange(text); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on text only
  }, [text]);
  return (
    <label className="relative flex h-8 w-full items-center sm:w-60">
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
      <input
        data-table-search
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setText(""); onChange(""); (e.target as HTMLInputElement).blur(); } if (e.key === "Enter") onChange(text); }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-md border bg-background pr-8 pl-8 text-[13px] shadow-xs outline-none placeholder:text-muted-foreground/80 focus:border-ring focus:ring-3 focus:ring-ring/20"
      />
      {text ? (
        <button onClick={() => { setText(""); onChange(""); }} className="absolute right-2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><XCircle className="size-3.5" /></button>
      ) : <Kbd className="pointer-events-none absolute right-2">/</Kbd>}
    </label>
  );
}

export function FacetChip({ facet, params, set }: { facet: Facet; params: URLSearchParams; set: Set }) {
  const [open, setOpen] = useState(false);
  const isRange = facet.kind === "date" || facet.kind === "number" || facet.kind === "money";
  const values = isRange ? [] : readValues(params, facet.key);
  const range = isRange ? readRange(params, facet.key) : {};
  const active = isRange ? !!(range.min || range.max) : values.length > 0;

  let summary = "";
  if (!isRange && values.length) {
    const opts = (facet as Extract<Facet, { kind: "enum" | "ref" }>).options;
    const labels = values.map((v) => opts.find((o) => o.value === v)?.label ?? v);
    summary = labels.length > 2 ? `${labels[0]}, ${labels[1]} +${labels.length - 2}` : labels.join(", ");
  } else if (isRange && active) {
    const f = (v?: string) => (!v ? "" : facet.kind === "date" ? formatDate(v) : facet.kind === "money" ? formatMoney(Number(v), "compact") : formatNumber(Number(v)));
    summary = range.min && range.max ? `${f(range.min)} – ${f(range.max)}` : range.min ? `≥ ${f(range.min)}` : `≤ ${f(range.max)}`;
  }
  const clear = () => set(isRange ? { [`f.${facet.key}.min`]: null, [`f.${facet.key}.max`]: null } : { [`f.${facet.key}`]: null });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("inline-flex h-7 items-stretch overflow-hidden rounded-md text-[12.5px] transition-colors", active ? "border border-primary/30 bg-primary/[0.06]" : "border border-dashed border-input hover:border-solid hover:bg-muted/60")}>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center gap-1.5 px-2 outline-none focus-visible:bg-muted">
            {!active && <CirclePlus className="size-3.5 text-muted-foreground" />}
            <span className={cn(active ? "text-muted-foreground" : "text-foreground/80")}>{facet.label}</span>
            {active && <><span className="h-3.5 w-px bg-primary/25" /><span className="max-w-48 truncate font-medium text-foreground">{summary}</span></>}
          </button>
        </PopoverTrigger>
        {active && <button onClick={clear} aria-label={`Clear ${facet.label}`} className="border-l border-primary/20 px-1.5 text-muted-foreground hover:bg-primary/10 hover:text-foreground"><X className="size-3" /></button>}
      </div>
      <PopoverContent align="start" className="w-64 p-0">
        {isRange
          ? <RangeEditor facet={facet} initial={range} onApply={(min, max) => { set({ [`f.${facet.key}.min`]: min || null, [`f.${facet.key}.max`]: max || null }); setOpen(false); }} />
          : <OptionList options={(facet as Extract<Facet, { kind: "enum" | "ref" }>).options} selected={values} onChange={(next) => set({ [`f.${facet.key}`]: next.length ? next.join(",") : null })} onClear={clear} />}
      </PopoverContent>
    </Popover>
  );
}

function OptionList({ options, selected, onChange, onClear }: { options: FacetOption[]; selected: string[]; onChange: (v: string[]) => void; onClear: () => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => (q ? options.filter((o) => (o.label ?? o.value).toLowerCase().includes(q.toLowerCase())) : options), [q, options]);
  return (
    <div>
      {options.length > 7 && (
        <div className="border-b p-1.5"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter options…" className="h-7 w-full rounded bg-muted/60 px-2 text-[12.5px] outline-none" /></div>
      )}
      <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable>
        {shown.map((o) => {
          const on = selected.includes(o.value);
          return (
            <li key={o.value}>
              <button role="option" aria-selected={on} onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])} className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] hover:bg-muted">
                <span className={cn("flex size-4 items-center justify-center rounded-[4px] border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                {o.tone && <span className={cn("size-1.5 rounded-full", TONE_DOT[o.tone])} />}
                <span className="flex-1 truncate">{o.label ?? o.value}</span>
                {o.count != null && <span className="text-[11.5px] text-muted-foreground tabular-nums">{formatNumber(o.count)}</span>}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="px-2 py-3 text-center text-muted-foreground">No options</li>}
      </ul>
      {selected.length > 0 && <div className="border-t p-1"><button onClick={onClear} className="h-7 w-full rounded text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground">Clear filter</button></div>}
    </div>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function datePresets(): { label: string; min?: string; max?: string }[] {
  const now = new Date();
  const add = (days: number) => { const d = new Date(now); d.setDate(d.getDate() + days); return iso(d); };
  const monthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return [
    { label: "Past due", max: add(-1) },
    { label: "Next 30 days", min: iso(now), max: add(30) },
    { label: "Next 60 days", min: iso(now), max: add(60) },
    { label: "This month", min: monthStart, max: monthEnd },
    { label: "Last 30 days", min: add(-30), max: iso(now) },
    { label: "Last 90 days", min: add(-90), max: iso(now) },
  ];
}

function RangeEditor({ facet, initial, onApply }: { facet: Facet; initial: { min?: string; max?: string }; onApply: (min?: string, max?: string) => void }) {
  const [min, setMin] = useState(initial.min ?? "");
  const [max, setMax] = useState(initial.max ?? "");
  const type = facet.kind === "date" ? "date" : "number";
  return (
    <div className="space-y-2 p-2">
      {facet.kind === "date" && (
        <div className="grid grid-cols-2 gap-1">
          {datePresets().map((p) => <button key={p.label} onClick={() => onApply(p.min, p.max)} className="h-7 rounded border px-2 text-left text-[12px] hover:border-primary/40 hover:bg-primary/5">{p.label}</button>)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{facet.kind === "date" ? "From" : "Min"}</span><input type={type} value={min} onChange={(e) => setMin(e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-[12.5px] tabular-nums outline-none focus:border-ring" /></label>
        <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{facet.kind === "date" ? "To" : "Max"}</span><input type={type} value={max} onChange={(e) => setMax(e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-[12.5px] tabular-nums outline-none focus:border-ring" /></label>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onApply(undefined, undefined)}>Clear</Button>
        <Button size="sm" onClick={() => onApply(min || undefined, max || undefined)}>Apply</Button>
      </div>
    </div>
  );
}

// ✦ AI filter: natural language → filter spec (lane E), applied to the URL with an undo.
export function AiFilter({ onAiFilter, apply, undo, applied }: { onAiFilter: AiFilterFn; apply: (r: AiFilterResult, text: string) => void; undo: () => void; applied: { text: string; explanation?: string } | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { apply(await onAiFilter(text.trim()), text.trim()); setOpen(false); setText(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't turn that into a filter"); }
    finally { setBusy(false); }
  };
  if (applied && !open) {
    return (
      <span className="inline-flex h-7 max-w-[360px] items-center gap-1.5 rounded-md border border-tone-ai/30 bg-tone-ai/[0.07] pr-1 pl-2 text-[12.5px]">
        <Sparkles className="size-3.5 shrink-0 text-tone-ai" />
        <span className="truncate" title={applied.explanation}>{applied.explanation ?? applied.text}</span>
        <button onClick={undo} className="inline-flex h-5 items-center gap-1 rounded px-1 text-muted-foreground hover:bg-tone-ai/10 hover:text-foreground" aria-label="Undo AI filter"><Undo2 className="size-3" /></button>
      </span>
    );
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-tone-ai/25 bg-gradient-to-b from-tone-ai/[0.04] to-tone-ai/[0.08] px-2 text-[12.5px] font-medium text-tone-ai transition-colors hover:border-tone-ai/45">
        <Sparkles className="size-3.5" /> AI filter
      </button>
    );
  }
  return (
    <div className="relative">
      <div className="flex h-7 w-[min(360px,80vw)] items-center gap-1.5 rounded-md border border-tone-ai/45 bg-background pr-1 pl-2 ring-3 ring-tone-ai/12">
        {busy ? <Loader2 className="size-3.5 animate-spin text-tone-ai" /> : <Sparkles className="size-3.5 text-tone-ai" />}
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void run(); if (e.key === "Escape") setOpen(false); }}
          onBlur={() => { if (!text && !busy) setOpen(false); }}
          placeholder="e.g. 2-beds vacant over 30 days in Austin"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
          disabled={busy}
        />
        <Kbd>↵</Kbd>
      </div>
      {err && <div className="absolute top-8 left-0 z-10 rounded-md border bg-popover px-2 py-1 text-[12px] text-tone-danger shadow-md">{err}</div>}
    </div>
  );
}
