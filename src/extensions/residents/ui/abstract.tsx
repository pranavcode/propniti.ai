"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "./client";

// Abstraction controls: run on the signed lease on file, or on a pasted / uploaded text lease.
// PDFs aren't read in the browser here; the upload accepts text exports (.txt, .md).
export function AbstractControls({ leaseId, hasResult }: { leaseId: string; hasResult: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState<{ name: string; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const run = async (body: object) => {
    setBusy(true);
    try {
      const r = await runAction("leases", leaseId, "leases.abstract", body);
      toast.success(r.message ?? "Abstraction finished");
      setPaste(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Abstraction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => run({})} data-tour="abstract-run">
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{hasResult ? "Re-run on lease on file" : "Abstract lease on file"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}><FileUp />Upload text lease</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPaste({ name: "Pasted lease", text: "" })}>Paste text</Button>
        <input ref={file} type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" aria-label="Upload a lease as text"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 60_000) return toast.error("That file is over 60 KB of text. Paste the lease terms section instead.");
            setPaste({ name: f.name, text: await f.text() });
          }} />
        {busy && <span className="text-[12px] text-muted-foreground">Reading the document and checking each term against the record…</span>}
      </div>
      {paste && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-[12.5px] font-medium">{paste.name}<Button size="icon-xs" variant="ghost" aria-label="Cancel" onClick={() => setPaste(null)}><X /></Button></div>
          <Textarea value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} rows={8} placeholder="Paste the lease text. Page breaks like “Page 2” keep page references accurate…" className="font-mono text-[12px]" maxLength={60_000} />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy || paste.text.trim().length < 200} onClick={() => run({ name: paste.name, text: paste.text })}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}Abstract this document</Button>
            <span className="text-[11.5px] text-muted-foreground">{paste.text.length.toLocaleString()} characters · the text is treated as data, never as instructions</span>
          </div>
        </div>
      )}
    </div>
  );
}
