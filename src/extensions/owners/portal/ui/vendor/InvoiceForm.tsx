"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Plus, ScanText, Trash2, Upload } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIBadge, Confidence } from "@/components/app/ai";
import { usePortalAction } from "../usePortalAction";

type Job = { id: string; title: string; property: string; estimate_cents: number | null };
type Line = { description: string; amount: string };
type Read = { source: "live" | "rules" | "manual"; confidence?: number; note?: string; checks?: { label: string; ok: boolean }[] };

// Upload an invoice: AI reads the file into lines (live model), or, with no vision model, the lines
// start from the job's estimate (rules). The vendor checks and edits them before sending.
export function InvoiceForm({ me, jobs, initialJob }: { me: string; jobs: Job[]; initialJob?: string }) {
  const router = useRouter();
  const { run, busy } = usePortalAction("vendors", me);
  const [jobId, setJobId] = useState(initialJob && jobs.some((j) => j.id === initialJob) ? initialJob : jobs[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<Read>({ source: "manual" });
  const [number, setNumber] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", amount: "" }]);
  const job = jobs.find((j) => j.id === jobId);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const onFile = async (f: File | null) => {
    setFile(f);
    setPreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    if (!f) return;
    setReading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/ai/extract", { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.invoice?.lineItems?.length) {
        setNumber(out.invoice.invoiceNumber || "");
        setLines(out.invoice.lineItems.map((l: { description: string; amount: number }) => ({ description: l.description, amount: String(l.amount.toFixed(2)) })));
        setRead({ source: "live", confidence: out.invoice.confidence, checks: out.checks });
      } else {
        // No vision model (or unreadable): start from the job's estimate and say so.
        const est = job?.estimate_cents;
        setLines([{ description: job ? `${job.title} (labor and materials)` : "Labor and materials", amount: est ? (est / 100).toFixed(2) : "" }]);
        setRead({ source: "rules", note: out.error ?? out.note ?? "We couldn't read the file automatically." });
      }
    } catch {
      setRead({ source: "manual", note: "Upload failed. Enter the lines yourself." });
    } finally {
      setReading(false);
    }
  };

  const cents = lines.map((l) => Math.round(Number(l.amount.replace(/[$,]/g, "")) * 100));
  const total = cents.reduce((a, c) => a + (Number.isFinite(c) && c > 0 ? c : 0), 0);
  const valid = !!jobId && number.trim() && lines.every((l, i) => l.description.trim() && cents[i] > 0);

  const submit = async () => {
    const r = await run("submit_invoice", { workOrderId: jobId, invoiceNumber: number.trim(), lines: lines.map((l, i) => ({ description: l.description.trim(), amount_cents: cents[i] })), fileName: file?.name ?? "", read: { source: read.source, ...(read.confidence != null ? { confidence: read.confidence } : {}) } });
    if (r.ok) router.replace("/portal/vendor/invoices");
  };

  if (!jobs.length) return <p className="rounded-xl border bg-card p-4 text-[13px] text-muted-foreground">No jobs are ready to invoice. Jobs show up here once they&apos;re scheduled or done.</p>;

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="inv-job">Job</Label>
          <Select value={jobId} onValueChange={setJobId}>
            <SelectTrigger id="inv-job" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.id} · {j.title} · {j.property}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label htmlFor="inv-file" className="flex min-h-48 cursor-pointer flex-col has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/60 items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-muted/30 p-4 text-center hover:border-primary/40 hover:bg-primary/[0.03]">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
          {preview ? <img src={preview} alt="Invoice preview" className="max-h-80 rounded object-contain" /> : file ? <><FileText className="size-8 text-muted-foreground" /><span className="text-[13px] font-medium">{file.name}</span></> : (
            <><Upload className="size-6 text-muted-foreground" /><span className="text-[13px] font-medium">Upload your invoice</span><span className="text-[12px] text-muted-foreground">Photo or PDF, up to 4 MB. AI reads the lines for you.</span></>
          )}
          <input id="inv-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {reading ? <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reading your invoice…</span>
            : read.source === "live" ? <><ScanText className="size-4 text-tone-ai" /><span className="text-[12.5px]">Filled in from your file. Check every line.</span><AIBadge source="live" size="xs" />{read.confidence != null && <Confidence value={read.confidence} />}</>
            : read.source === "rules" ? <><AIBadge source="rules" size="xs" /><span className="text-[12.5px] text-muted-foreground">{read.note} We started from the job estimate; change it to match your invoice.</span></>
            : <span className="text-[12.5px] text-muted-foreground">{read.note ?? "Upload a file to fill this in, or type the lines."}</span>}
        </div>
        {read.checks?.some((c) => !c.ok) && <ul className="rounded-md border border-tone-warning/30 bg-tone-warning/5 px-3 py-2 text-[12px]">{read.checks.filter((c) => !c.ok).map((c) => <li key={c.label}>Check: {c.label}</li>)}</ul>}
        <div className="space-y-1.5">
          <Label htmlFor="inv-no">Invoice number</Label>
          <Input id="inv-no" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. LSP-2041" maxLength={40} autoComplete="off" />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Lines</legend>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Description" maxLength={200} className="flex-1" />
              <Input aria-label={`Line ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} placeholder="0.00" className="w-28 text-right tabular-nums" />
              <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, { description: "", amount: "" }])} disabled={lines.length >= 20}><Plus />Add line</Button>
        </fieldset>
        <div className="flex items-center justify-between border-t pt-3">
          <p className="text-[13px]">Total <span className="ml-1 text-[17px] font-semibold tabular-nums">{formatMoney(total / 100)}</span>{job?.estimate_cents ? <span className="ml-2 text-[12px] text-muted-foreground">estimate {formatMoney(job.estimate_cents / 100)}</span> : null}</p>
          <Button onClick={submit} disabled={!valid || !!busy} className="max-md:h-11">{busy ? "Sending…" : "Send invoice"}</Button>
        </div>
      </div>
    </div>
  );
}
