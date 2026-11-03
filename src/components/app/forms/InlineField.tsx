"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber, formatPct } from "@/lib/format";
import { useOptimisticSave } from "@/hooks/use-optimistic-save";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Money, StatusBadge } from "../display";
import { TONE_DOT } from "../status";
import { apiJson, recordUrl } from "./api";
import type { FieldSpec } from "./types";
import { zodFor } from "./zod";

export type SaveField = (key: string, value: unknown) => Promise<unknown>;

export function displayValue(spec: FieldSpec, v: unknown): React.ReactNode {
  if (v == null || v === "") return <span className="text-muted-foreground/60">—</span>;
  switch (spec.type) {
    case "money": return <Money value={Number(v)} style={spec.format === "compact" ? "compact" : "full"} />;
    case "number": return <span className="tabular-nums">{spec.format === "pct" ? formatPct(Number(v)) : formatNumber(Number(v))}</span>;
    case "date": return <span className="tabular-nums">{formatDate(v as string, "always")}</span>;
    case "enum": return <StatusBadge value={v} enumDef={spec.enum} />;
    case "bool": return v ? "Yes" : "No";
    case "ref": return spec.options?.find((o) => o.value === v)?.label ?? String(v);
    case "json": return <span className="font-mono text-[11.5px] text-muted-foreground">{JSON.stringify(v)}</span>;
    default: return <span className="break-words">{String(v)}</span>;
  }
}

// Click-to-edit field (record details rail). Enter or blur saves, Esc cancels. Enum, ref and bool
// save as soon as a choice is made. Optimistic, with an Undo toast.
export function InlineField({ spec, value, entity, id, onSave, layout = "row", className }: {
  spec: FieldSpec;
  value: unknown;
  entity?: string;
  id?: string;
  onSave?: SaveField;
  layout?: "row" | "stack";
  className?: string;
}) {
  const save = useCallback(async (next: unknown) => {
    if (onSave) return onSave(spec.key, next);
    if (!entity || !id) throw new Error("Nowhere to save this field");
    return apiJson("PATCH", recordUrl(entity, id), { [spec.key]: next });
  }, [onSave, entity, id, spec.key]);
  const { value: current, set, saving } = useOptimisticSave<unknown>(value, save, { success: `${spec.label} updated` });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editable = spec.editable !== false && spec.type !== "json" && spec.type !== "image";

  const begin = () => {
    if (!editable) return;
    setDraft(current == null ? "" : String(current));
    setErr(null);
    setEditing(true);
  };

  const commit = (raw: unknown = draft) => {
    let next: unknown = raw;
    if (spec.type === "number" || spec.type === "money") next = raw === "" || raw == null ? null : Number(String(raw).replace(/[$,\s]/g, ""));
    if ((spec.type === "text" || spec.type === "date") && raw === "") next = spec.type === "text" && spec.required ? "" : null;
    const parsed = zodFor(spec).safeParse(next);
    if (!parsed.success) { setErr(parsed.error.issues[0]?.message ?? "Invalid value"); inputRef.current?.focus(); return; }
    setEditing(false);
    if (parsed.data === current || (parsed.data == null && (current == null || current === ""))) return;
    void set(parsed.data);
  };

  let control: React.ReactNode;
  if (spec.type === "bool" && editable) {
    control = <Switch checked={!!current} disabled={saving} onCheckedChange={(v) => void set(v)} aria-label={spec.label} />;
  } else if ((spec.type === "enum" || (spec.type === "ref" && spec.options)) && editable) {
    const opts = spec.type === "enum" ? (spec.enum ?? []).map((e) => ({ value: e.value, label: e.label ?? e.value, tone: e.tone })) : spec.options!.map((o) => ({ ...o, tone: undefined }));
    control = (
      <Select value={current == null ? undefined : String(current)} onValueChange={(v) => void set(v)} disabled={saving}>
        <SelectTrigger size="sm" aria-label={spec.label} className="-ml-2 h-7 w-auto max-w-full border-transparent bg-transparent px-2 text-[13px] shadow-none hover:bg-muted data-[state=open]:bg-muted [&>svg]:opacity-0 hover:[&>svg]:opacity-60">
          <SelectValue placeholder={<span className="text-muted-foreground/60">—</span>}>{displayValue(spec, current)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.tone && <span className={cn("size-1.5 rounded-full", TONE_DOT[o.tone])} />}{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  } else if (editing) {
    control = (
      <div className="relative -ml-2 flex items-center">
        {spec.type === "money" && <span className="pointer-events-none absolute left-2 text-muted-foreground">$</span>}
        <input autoComplete="off"
          ref={inputRef}
          autoFocus
          type={spec.type === "date" ? "date" : "text"}
          inputMode={spec.type === "number" || spec.type === "money" ? "decimal" : undefined}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(false); setErr(null); }
          }}
          aria-label={spec.label}
          aria-invalid={!!err}
          className={cn("h-7 w-full rounded-md border bg-background px-2 text-[13px] tabular-nums outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 aria-invalid:border-tone-danger aria-invalid:ring-tone-danger/15", spec.type === "money" && "pl-5")}
        />
      </div>
    );
  } else {
    control = (
      <button
        type="button"
        onClick={begin}
        disabled={!editable}
        className={cn("group/if -ml-2 flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-[13px] disabled:cursor-default", editable && "hover:bg-muted")}
      >
        <span className="min-w-0 flex-1 truncate">{displayValue(spec, current)}</span>
        {saving ? <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" /> : editable && <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/if:opacity-70" />}
      </button>
    );
  }

  return (
    <div className={cn(layout === "row" ? "grid grid-cols-[minmax(96px,38%)_1fr] items-start gap-2" : "space-y-0.5", className)}>
      <div className={cn("truncate text-[12.5px] text-muted-foreground", layout === "row" && "pt-1.5")} title={spec.help}>{spec.label}{spec.required && editing && <span className="text-tone-danger"> *</span>}</div>
      <div className="min-w-0">
        {control}
        {err && <div role="alert" className="mt-1 text-[11.5px] text-tone-danger">{err}</div>}
        {editing && !err && <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Check className="size-3" /> Enter to save · Esc to cancel</div>}
      </div>
    </div>
  );
}
