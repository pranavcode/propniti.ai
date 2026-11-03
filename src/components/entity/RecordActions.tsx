"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBreadcrumbTitle, useShellMaybe } from "@/components/app/shell/context";
import { useUrlState } from "@/hooks/use-url-state";
import { RecordSheet } from "./RecordSheet";
import type { FormField } from "./spec";

export type ActionButton = { key: string; label: string; confirm?: { title: string; body?: string }; money: boolean; hasInput: boolean };

// Header actions on a record page: named actions (with confirmation), Edit (sheet; also opened by
// ?edit=1), Delete, and "Ask about this" into the assistant dock. Also sets the breadcrumb title.
export function RecordActions({ entity, id, title, label, routeBase, actions, edit, canDelete }: {
  entity: string;
  id: string;
  title: string;
  label: { one: string; many: string };
  routeBase: string;
  actions: ActionButton[];
  edit?: { fields: FormField[]; initial: Record<string, unknown> };
  canDelete: boolean;
}) {
  useBreadcrumbTitle(title);
  const router = useRouter();
  const shell = useShellMaybe();
  const { params, set } = useUrlState();
  const [editLocal, setEditLocal] = useState(false);
  const editOpen = editLocal || (!!edit && params.get("edit") === "1");
  const setEdit = (o: boolean) => {
    setEditLocal(o);
    if (!o && params.get("edit")) set({ edit: null });
  };
  const [confirm, setConfirm] = useState<ActionButton | "delete" | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (a: ActionButton | "delete") => {
    setBusy(true);
    const res = a === "delete"
      ? await fetch(`/api/e/${entity}/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null)
      : await fetch(`/api/e/${entity}/${encodeURIComponent(id)}/actions/${encodeURIComponent(a.key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    setConfirm(null);
    if (!res || !res.ok) return toast.error(out.error ?? "Nothing was changed. Try again.");
    if (a === "delete") {
      toast.success(`${label.one} deleted`);
      return router.push(routeBase);
    }
    toast.success(out.message ?? `${a.label} done`);
    if (out.href) router.push(out.href);
    else router.refresh();
  };

  const pending = confirm === "delete" ? { title: `Delete this ${label.one.toLowerCase()}?`, body: "It disappears from lists and searches. The change is recorded in the audit log." } : confirm?.confirm ?? (confirm ? { title: `${confirm.label}?` } : null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shell && <Button variant="outline" size="sm" onClick={() => shell.assistant.ask(`Tell me about ${title}`, { entity, id, title })}><Sparkles className="size-4 text-tone-ai" />Ask about this</Button>}
      {actions.filter((a) => !a.hasInput).map((a) => (
        <Button key={a.key} size="sm" variant={a.money ? "default" : "outline"} disabled={busy} onClick={() => (a.confirm || a.money ? setConfirm(a) : run(a))}>{a.label}</Button>
      ))}
      {edit && <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil className="size-4" />Edit</Button>}
      {canDelete && <Button size="icon-sm" variant="ghost" aria-label={`Delete ${label.one.toLowerCase()}`} onClick={() => setConfirm("delete")}><Trash2 className="size-4" /></Button>}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            {pending?.body && <DialogDescription>{pending.body}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === "delete" ? "destructive" : "default"} disabled={busy} onClick={() => confirm && run(confirm)}>{busy ? "Working…" : confirm === "delete" ? "Delete" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {edit && <RecordSheet entity={entity} label={label} mode="update" id={id} fields={edit.fields} initial={edit.initial} open={editOpen} onOpenChange={setEdit} routeBase={routeBase} />}
    </div>
  );
}
