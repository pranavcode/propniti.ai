"use client";

import { useState } from "react";
import { Check, ImagePlus, Loader2, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FIELD, useAction } from "./client";

// Small interactive controls used inside the maintenance record tabs.

export function AddPhoto({ woId, photos }: { woId: string; photos: { url: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [stage, setStage] = useState("Before");
  const { run, busy } = useAction();
  const submit = async () => {
    if (!url) return;
    if (await run("work_orders", woId, "work_orders.add_photo", { url, stage })) setOpen(false);
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><ImagePlus className="size-3.5" />Add photo</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a photo</DialogTitle>
            <DialogDescription>The demo can&apos;t store uploads, so pick one of the sample job photos. The photo check runs as soon as it&apos;s added.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" role="radiogroup" aria-label="Sample photos">
            {photos.map((p) => (
              <button key={p.url} type="button" role="radio" aria-checked={url === p.url} onClick={() => setUrl(p.url)}
                className={cn("group relative overflow-hidden rounded-md ring-1 ring-border transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", url === p.url && "ring-2 ring-primary")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public */}
                <img src={p.url.replace(/\.webp$/, "-400.webp")} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
                <span className="block truncate px-1.5 py-1 text-left text-[11.5px]">{p.label}</span>
                {url === p.url && <Check className="absolute top-1.5 right-1.5 size-5 rounded-full bg-primary p-0.5 text-primary-foreground" />}
              </button>
            ))}
          </div>
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <label className="flex items-center gap-2 text-[13px]">Stage
              <select value={stage} onChange={(e) => setStage(e.target.value)} className={cn(FIELD, "w-32")}>
                {["Before", "After", "Evidence"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!url || !!busy} onClick={submit}>{busy && <Loader2 className="size-4 animate-spin" />}Add and check</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const CONDITIONS = ["Good", "Fair", "Damaged", "Missing", "N/A"] as const;

export function ConditionSelect({ inspectionId, itemId, value, disabled, label }: { inspectionId: string; itemId: string; value: string; disabled?: boolean; label: string }) {
  const { run, busy } = useAction();
  const [v, setV] = useState(value);
  return (
    <select aria-label={`Condition of ${label}`} value={v} disabled={disabled || !!busy}
      onChange={async (e) => {
        const next = e.target.value;
        setV(next);
        if (!(await run("inspections", inspectionId, "inspections.set_item", { item_id: itemId, condition: next }, { quiet: true }))) setV(value);
      }}
      className={cn(FIELD, "w-28", (v === "Damaged" || v === "Missing") && "border-tone-danger/40 text-tone-danger")}>
      {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
    </select>
  );
}

export function RaiseWorkOrder({ inspectionId, itemId }: { inspectionId: string; itemId: string }) {
  const { run, busy } = useAction();
  return (
    <Button size="xs" variant="outline" disabled={!!busy} onClick={() => run("inspections", inspectionId, "inspections.raise_work_order", { item_id: itemId }, { follow: true })}>
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Wrench className="size-3" />}Raise work order
    </Button>
  );
}

export function StepToggle({ turnoverId, index, done, step, by, disabled }: { turnoverId: string; index: number; done: boolean; step: string; by: string | null; disabled?: boolean }) {
  const { run, busy } = useAction();
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40", disabled && "cursor-default")}>
      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={done} disabled={disabled || !!busy}
        onChange={(e) => run("turnovers", turnoverId, "turnovers.toggle_step", { index, done: e.target.checked }, { quiet: true })} />
      <span className={cn("flex-1 text-[13px]", done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{step}</span>
      {busy ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : by && <span className="text-[11.5px] text-muted-foreground">{by}</span>}
    </label>
  );
}

export function AddCost({ turnoverId }: { turnoverId: string }) {
  const { run, busy } = useAction();
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const value = Number(amount);
  return (
    <form className="flex flex-wrap items-end gap-2 p-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await run("turnovers", turnoverId, "turnovers.add_cost", { item: item.trim(), amount: value })) { setItem(""); setAmount(""); }
    }}>
      <label className="grid min-w-48 flex-1 gap-1 text-[12px] text-muted-foreground">What it was for
        <input className={FIELD} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Blinds replaced in bedroom…" maxLength={120} required minLength={2} />
      </label>
      <label className="grid w-32 gap-1 text-[12px] text-muted-foreground">Amount ($)
        <input className={cn(FIELD, "tabular-nums")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" required />
      </label>
      <Button type="submit" size="sm" disabled={!!busy || !(value > 0) || item.trim().length < 2}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Add cost</Button>
    </form>
  );
}

export function KeyCheckout({ keyId, people }: { keyId: string; people: { kind: "staff" | "vendor"; id: string; name: string }[] }) {
  const { run, busy } = useAction();
  const [who, setWho] = useState("");
  const [wo, setWo] = useState("");
  const p = people.find((x) => `${x.kind}:${x.id}` === who);
  return (
    <form className="flex flex-wrap items-end gap-2 p-3" onSubmit={(e) => {
      e.preventDefault();
      if (p) run("keys", keyId, "keys.check_out", { holder_kind: p.kind, holder_id: p.id, ...(wo.trim() ? { work_order_id: wo.trim() } : {}) });
    }}>
      <label className="grid min-w-56 flex-1 gap-1 text-[12px] text-muted-foreground">Hand to
        <select className={FIELD} value={who} onChange={(e) => setWho(e.target.value)} required>
          <option value="">Choose a person or vendor…</option>
          <optgroup label="Staff">{people.filter((x) => x.kind === "staff").map((x) => <option key={x.id} value={`staff:${x.id}`}>{x.name}</option>)}</optgroup>
          <optgroup label="Vendors">{people.filter((x) => x.kind === "vendor").map((x) => <option key={x.id} value={`vendor:${x.id}`}>{x.name}</option>)}</optgroup>
        </select>
      </label>
      <label className="grid w-40 gap-1 text-[12px] text-muted-foreground">For work order (optional)
        <input className={FIELD} value={wo} onChange={(e) => setWo(e.target.value)} placeholder="WO-10482" maxLength={40} />
      </label>
      <Button type="submit" size="sm" disabled={!p || !!busy}>{busy && <Loader2 className="size-3.5 animate-spin" />}Check out</Button>
    </form>
  );
}
