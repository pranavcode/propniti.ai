"use client";

import { useState } from "react";
import { Download, Eye, FileImage, FileSpreadsheet, FileText, Sparkles } from "lucide-react";
import { formatPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { RelativeDate } from "../display";
import { EmptyState, ErrorBanner } from "../states";
import { useCollab } from "./useCollab";

// Documents filed to a record (documents table), with auto-filing provenance and inline preview.

export type DocumentRow = { id: string; name: string; url: string | null; mime: string; doc_type?: string | null; classify_confidence?: number | null; filed_to?: string | null; classified_by?: string | null; uploaded_by?: string | null; uploaded_at: string };

function DocIcon({ mime }: { mime: string }) {
  const Icon = mime.startsWith("image/") ? FileImage : /sheet|csv|excel/.test(mime) ? FileSpreadsheet : FileText;
  const tint = mime.startsWith("image/") ? "text-tone-info bg-tone-info/10" : /sheet|csv|excel/.test(mime) ? "text-tone-success bg-tone-success/10" : "text-tone-danger bg-tone-danger/10";
  return <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${tint}`}><Icon className="size-4" /></span>;
}

export function DocumentsPanel({ entity, id, initial }: { entity: string; id: string; initial?: DocumentRow[] }) {
  const { rows, loading, error, reload } = useCollab<DocumentRow>(entity, id, "documents", initial);
  const [preview, setPreview] = useState<DocumentRow | null>(null);

  if (error) return <ErrorBanner title="Couldn't load documents" message={error} onRetry={reload} />;
  if (loading) return <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (!rows.length) return <EmptyState compact kind="documents" title="No documents filed here" description="Leases, invoices, COIs and notices land here. The document agent files uploads automatically and shows its confidence." />;

  return (
    <>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {rows.map((d) => (
          <li key={d.id} className="group/doc flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
            <DocIcon mime={d.mime} />
            <div className="min-w-0 flex-1">
              {d.url
                ? <button onClick={() => setPreview(d)} className="block max-w-full truncate text-left font-medium hover:text-primary hover:underline">{d.name}</button>
                : <span className="block max-w-full truncate font-medium" title="No file attached">{d.name}</span>}
              <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                {d.doc_type && <span>{d.doc_type}</span>}
                <span>· <RelativeDate value={d.uploaded_at} /></span>
                {d.classify_confidence != null && (
                  <span className="inline-flex items-center gap-1 text-tone-ai" title={d.filed_to ?? undefined}><Sparkles className="size-3" /> Auto-filed · {formatPct(d.classify_confidence, 0)}</span>
                )}
              </div>
            </div>
            {d.url && (
              <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover/doc:opacity-100">
                <Button variant="ghost" size="icon-sm" onClick={() => setPreview(d)} aria-label={`Preview ${d.name}`}><Eye /></Button>
                <Button asChild variant="ghost" size="icon-sm"><a href={d.url} download aria-label={`Download ${d.name}`}><Download /></a></Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
            <DialogDescription>{[preview?.doc_type, preview?.filed_to].filter(Boolean).join(" · ") || "Document preview"}</DialogDescription>
          </DialogHeader>
          {preview && (preview.mime.startsWith("image/")
            // eslint-disable-next-line @next/next/no-img-element -- user documents, shown as-is
            ? <img src={preview.url ?? undefined} alt={preview.name} className="max-h-[70vh] w-full rounded-md border object-contain" />
            : <iframe src={preview.url ?? undefined} title={preview.name} className="h-[70vh] w-full rounded-md border bg-muted" />)}
        </DialogContent>
      </Dialog>
    </>
  );
}
