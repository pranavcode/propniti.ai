"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { notifyDone } from "./notify";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { FormField } from "./spec";

type Row = Record<string, unknown>;

// New / edit sheet generated from the def's fields (plain FormField data). Creates POST to
// /api/e/<entity>, edits PATCH only the fields that changed. Server-side zod from the same defs
// has the final say; its message is shown inline.

const NUMERIC = new Set(["number", "money"]);

function toInput(f: FormField, v: unknown): string | boolean {
  if (f.type === "bool") return !!v;
  if (v == null) return "";
  if (f.type === "datetime") return String(v).slice(0, 16);
  return String(v);
}

function fromInput(f: FormField, v: string | boolean): unknown {
  if (f.type === "bool") return !!v;
  if (v === "") return null;
  if (NUMERIC.has(f.type)) return Number(v);
  if (f.type === "datetime") return new Date(String(v)).toISOString();
  return v;
}

function RefInput({ f, value, onChange, id }: { f: FormField; value: string; onChange: (v: string) => void; id: string }) {
  const [opts, setOpts] = useState<{ id: string; title: string }[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!f.refEntity) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/e/${f.refEntity}?size=25${q ? `&q=${encodeURIComponent(q)}` : ""}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((b: { rows: Row[] }) => setOpts(b.rows.map((r) => ({ id: String(r.id), title: String(r._title ?? r.id) }))))
        .catch(() => {});
    }, 150);
    return () => (clearTimeout(t), ctrl.abort());
  }, [f.refEntity, q]);
  // A prefilled value may not be among the first options: look its title up once.
  const [named, setNamed] = useState<{ id: string; title: string } | null>(null);
  const [first] = useState(value);
  useEffect(() => {
    if (!f.refEntity || !first) return;
    const ctrl = new AbortController();
    fetch(`/api/e/${f.refEntity}/${encodeURIComponent(first)}?relations=0`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { row: Row } | null) => b && setNamed({ id: first, title: String(b.row._title ?? first) }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [f.refEntity, first]);
  const listId = `${id}-list`;
  const current = opts.find((o) => o.id === value) ?? (named?.id === value ? named : undefined);
  return (
    <>
      <Input id={id} list={listId} value={value} onChange={(e) => { onChange(e.target.value); setQ(e.target.value); }} placeholder={`Search ${f.label.toLowerCase()}…`} autoComplete="off" />
      <datalist id={listId}>{opts.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</datalist>
      {current && <p className="text-[11.5px] text-muted-foreground">{current.title}</p>}
    </>
  );
}

export function RecordSheet({ entity, label, mode, fields, initial, id, open, onOpenChange, routeBase }: {
  entity: string;
  label: { one: string; many: string };
  mode: "create" | "update";
  fields: FormField[];
  initial?: Row;
  id?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeBase: string;
}) {
  const router = useRouter();
  const uid = useId();
  const start = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, toInput(f, initial?.[f.key])])), [fields, initial]);
  const [values, setValues] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevStart, setPrevStart] = useState(start);
  if (start !== prevStart) { setPrevStart(start); setValues(start); }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Row = {};
    for (const f of fields) {
      const v = values[f.key];
      if (mode === "update" ? v === start[f.key] : v === "" || v === undefined) continue;
      body[f.key] = fromInput(f, v);
    }
    if (mode === "update" && !Object.keys(body).length) { setBusy(false); onOpenChange(false); return; }
    const res = await fetch(mode === "create" ? `/api/e/${entity}` : `/api/e/${entity}/${encodeURIComponent(id!)}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const out = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      const issues = (out.issues as { path: (string | number)[]; message: string }[] | undefined)?.map((i) => `${fields.find((f) => f.key === i.path[0])?.label ?? i.path.join(".")}: ${i.message}`);
      setError(issues?.length ? issues.join(" · ") : (out.error as string) ?? "Couldn't save. Check your connection and try again.");
      return;
    }
    onOpenChange(false);
    if (mode === "create") {
      const rid = String((out.row as Row).id);
      const href = `${routeBase}/${encodeURIComponent(rid)}`;
      notifyDone(`${label.one} created`, { href, go: router.push });
      router.push(href);
    } else {
      toast.success(`${label.one} updated`);
      router.refresh();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>{mode === "create" ? `New ${label.one.toLowerCase()}` : `Edit ${label.one.toLowerCase()}`}</SheetTitle>
          <SheetDescription>{mode === "create" ? "Fields marked * are required." : "Only the fields you change are saved, and every change is recorded in the activity log."}</SheetDescription>
        </SheetHeader>
        <form id={`${uid}-form`} onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto p-4">
          {fields.map((f) => {
            const fid = `${uid}-${f.key}`;
            const v = values[f.key];
            const set = (nv: string | boolean) => setValues((s) => ({ ...s, [f.key]: nv }));
            return (
              <div key={f.key} className="space-y-1.5">
                <label htmlFor={fid} className="flex items-center justify-between text-[12.5px] font-medium">
                  <span>{f.label}{f.required && <span className="text-tone-danger"> *</span>}</span>
                  {f.type === "money" && <span className="font-normal text-muted-foreground">USD</span>}
                </label>
                {f.type === "bool" ? (
                  <Switch id={fid} checked={!!v} onCheckedChange={(c) => set(c)} />
                ) : f.type === "enum" && f.options ? (
                  <select id={fid} value={String(v)} required={f.required} onChange={(e) => set(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30">
                    <option value="">{f.required ? "Choose…" : "—"}</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === "ref" ? (
                  <RefInput f={f} id={fid} value={String(v)} onChange={set} />
                ) : f.key === "description" || f.key === "detail" ? (
                  <Textarea id={fid} value={String(v)} required={f.required} onChange={(e) => set(e.target.value)} rows={3} />
                ) : (
                  <Input id={fid} value={String(v)} required={f.required} onChange={(e) => set(e.target.value)}
                    type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : NUMERIC.has(f.type) ? "number" : "text"}
                    step={f.type === "money" ? "0.01" : f.type === "number" ? "any" : undefined}
                    inputMode={NUMERIC.has(f.type) ? "decimal" : undefined} className="tabular-nums" />
                )}
                {f.help && <p className="text-[11.5px] text-muted-foreground">{f.help}</p>}
              </div>
            );
          })}
          {error && <p role="alert" className="rounded-md border border-tone-danger/25 bg-tone-danger/5 px-3 py-2 text-[12.5px] text-tone-danger">{error}</p>}
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} disabled={busy}>{busy ? "Saving…" : mode === "create" ? `Create ${label.one.toLowerCase()}` : "Save changes"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
