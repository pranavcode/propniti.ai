"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiJson, recordUrl } from "./api";

// Confirmation for destructive or irreversible actions. typeToConfirm asks the person to type a
// word (e.g. the record name) before the button enables.
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", tone = "danger", typeToConfirm, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "default";
  typeToConfirm?: string;
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = !typeToConfirm || typed.trim() === typeToConfirm;
  const close = (o: boolean) => { if (!o) { setTyped(""); setErr(null); } onOpenChange(o); };
  const run = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(); close(false); }
    catch (e) { setErr(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {tone === "danger" && <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tone-danger/10 text-tone-danger"><AlertTriangle className="size-4" /></span>}
            <div className="space-y-1">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>
        {typeToConfirm && (
          <label className="block space-y-1.5">
            <span className="text-[12.5px] text-muted-foreground">Type <span className="font-medium text-foreground">{typeToConfirm}</span> to confirm</span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" />
          </label>
        )}
        {err && <div role="alert" className="rounded-md bg-tone-danger/[0.06] px-3 py-2 text-[12.5px] text-tone-danger">{err}</div>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={!ready || busy} className={cn(tone === "danger" && "bg-tone-danger text-white hover:bg-tone-danger/90")}>
            {busy && <Loader2 className="animate-spin" />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Delete a generic record (DELETE /api/e/{entity}/{id}), then go back to the list.
export function DeleteRecordDialog({ open, onOpenChange, entity, id, label, title, listHref }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entity: string;
  id: string;
  label: string;          // "unit"
  title: string;          // record title, also the type-to-confirm word
  listHref?: string;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${label} ${title}?`}
      description={`It disappears from lists and search. The audit log keeps a copy of every field.`}
      confirmLabel={`Delete ${label}`}
      typeToConfirm={title.length <= 40 ? title : undefined}
      onConfirm={async () => {
        await apiJson("DELETE", recordUrl(entity, id));
        toast.success(`Deleted ${label} ${title}`);
        if (listHref) router.push(listHref); else router.refresh();
      }}
    />
  );
}
