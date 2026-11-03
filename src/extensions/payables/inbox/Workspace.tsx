"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, ArrowUpRight, BadgeCheck, CheckCircle2, CircleDollarSign, FileUp, Loader2, Plus, ScanLine, Send, Sparkles, Trash2, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AIBadge, Confidence, type AISource } from "@/components/app/ai";
import { Money, StatusBadge } from "@/components/app/display";
import { ConfirmDialog } from "@/components/app/forms";
import { hardStop, proposeGl, runChecks, type Check, type GlOption, type VendorFacts } from "./checks";
import { post, runBillAction } from "./actions-client";
import type { ExtractedInvoice } from "./samples";

export type InboxItem =
  | { kind: "sample"; key: string; file: string; title: string; vendorId: string; propertyId: string; extracted: ExtractedInvoice; enteredAs: { id: string; status: string } | null }
  | { kind: "bill"; id: string; status: string; vendorId: string; propertyId: string; invoiceNumber: string; billDate: string; dueOn: string; amount: number; lines: { description: string; gl_account_id: string; amount: number }[]; docUrl: string | null; docName: string | null; extracted: ExtractedInvoice | null }
  | { kind: "upload" };

type Props = {
  item: InboxItem;
  vendors: VendorFacts[];
  properties: { id: string; name: string; owner_entity_id: string }[];
  gls: GlOption[];
  today: string;
  canPay: boolean;
};

type Line = { key: string; description: string; gl_account_id: string; amount: string; proposal: ReturnType<typeof proposeGl> };

let lineSeq = 0;
const newKey = () => `line-${++lineSeq}`;
const blankLine = (): Line => ({ key: newKey(), description: "", gl_account_id: "", amount: "", proposal: null });
type Stage = { billId: string; status: string } | null;

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const cents = (s: string) => Math.round((Number(String(s).replace(/[$,\s]/g, "")) || 0) * 100);
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|co|company|corp|services?)\b/g, "").trim();

export function matchVendor(name: string, vendors: VendorFacts[]): VendorFacts | null {
  const n = norm(name);
  if (!n) return null;
  return vendors.find((v) => norm(v.company) === n) ?? vendors.find((v) => norm(v.company).startsWith(n) || n.startsWith(norm(v.company))) ?? null;
}

function toLines(src: { description: string; gl_account_id?: string; amount: number }[], vendor: VendorFacts | null, gls: GlOption[]): Line[] {
  return src.map((l) => {
    const proposal = vendor ? proposeGl(vendor, l.description, gls) : null;
    return { key: newKey(), description: l.description, gl_account_id: l.gl_account_id || proposal?.gl_account_id || "", amount: l.amount.toFixed(2), proposal };
  });
}

export function Workspace({ item, vendors, properties, gls, today, canPay }: Props) {
  const router = useRouter();
  const initial = useMemo(() => {
    if (item.kind === "sample") {
      const v = vendors.find((x) => x.id === item.vendorId) ?? matchVendor(item.extracted.vendor, vendors);
      return { vendorId: v?.id ?? "", propertyId: item.propertyId, invoice: item.extracted.invoice_number, billDate: item.extracted.invoice_date, dueOn: item.extracted.due_date, lines: toLines(item.extracted.lines, v, gls), extracted: item.extracted, source: "precomputed" as AISource };
    }
    if (item.kind === "bill") {
      const v = vendors.find((x) => x.id === item.vendorId) ?? null;
      return { vendorId: item.vendorId, propertyId: item.propertyId, invoice: item.invoiceNumber, billDate: item.billDate, dueOn: item.dueOn, lines: toLines(item.lines.length ? item.lines : [{ description: "", amount: item.amount }], v, gls), extracted: item.extracted, source: "precomputed" as AISource };
    }
    return { vendorId: "", propertyId: properties[0]?.id ?? "", invoice: "", billDate: today, dueOn: addDays(today, 30), lines: [] as Line[], extracted: null, source: "live" as AISource };
  }, [item, vendors, gls, properties, today]);

  const [vendorId, setVendorId] = useState(initial.vendorId);
  const [propertyId, setPropertyId] = useState(initial.propertyId);
  const [invoice, setInvoice] = useState(initial.invoice);
  const [billDate, setBillDate] = useState(initial.billDate);
  const [dueOn, setDueOn] = useState(initial.dueOn);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(initial.extracted);
  const [extractSource, setExtractSource] = useState<{ source: AISource; model?: string } | null>(item.kind === "upload" ? null : { source: initial.source });
  const [upload, setUpload] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "reading" | "manual" | "read">(item.kind === "upload" ? "idle" : "read");
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [dupHit, setDupHit] = useState<{ key: string; hit: { id: string; status: string } | null }>({ key: "", hit: null });
  const [stage, setStage] = useState<Stage>(item.kind === "bill" && item.status !== "Draft" ? { billId: item.id, status: item.status } : item.kind === "sample" && item.enteredAs ? { billId: item.enteredAs.id, status: item.enteredAs.status } : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"approve" | "approve_and_pay" | "pay" | null>(null);

  const vendor = vendors.find((v) => v.id === vendorId) ?? null;
  const property = properties.find((p) => p.id === propertyId) ?? null;
  const draftLines = lines.map((l) => ({ description: l.description, gl_account_id: l.gl_account_id, amount_cents: cents(l.amount) }));
  const total = draftLines.reduce((s, l) => s + l.amount_cents, 0);
  const dupKey = `${vendorId}|${invoice.trim().toLowerCase()}`;
  const dup = dupHit.key === dupKey ? dupHit.hit : null;
  const checks = runChecks({ vendor, amountCents: total, lines: draftLines, duplicateOf: dup, scannedTotalCents: extracted ? Math.round(extracted.total * 100) : null, remitLast4: extracted?.remit_last4 ?? null, gls });
  const stop = hardStop(checks);
  const warnings = checks.filter((c) => c.level === "warn").length;

  // Duplicate invoice number for this vendor, looked up as the person types.
  const excludeId = item.kind === "bill" ? item.id : stage?.billId;
  useEffect(() => {
    if (!vendorId || !invoice.trim()) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/e/bills?f.vendor_id=${encodeURIComponent(vendorId)}&q=${encodeURIComponent(invoice.trim())}&size=10`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rows?: { id: string; invoice_number: string; status: string }[] } | null) => {
          const hit = d?.rows?.find((r) => r.id !== excludeId && r.status !== "Void" && r.invoice_number.trim().toLowerCase() === invoice.trim().toLowerCase());
          setDupHit({ key: `${vendorId}|${invoice.trim().toLowerCase()}`, hit: hit ? { id: hit.id, status: hit.status } : null });
        })
        .catch(() => {});
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [vendorId, invoice, excludeId]);

  // Free the uploaded file's object URL when it's replaced or the workspace closes.
  const uploadUrl = upload?.url;
  useEffect(() => () => { if (uploadUrl) URL.revokeObjectURL(uploadUrl); }, [uploadUrl]);

  const setVendor = (id: string) => {
    setVendorId(id);
    const v = vendors.find((x) => x.id === id) ?? null;
    setLines((ls) => ls.map((l) => {
      const proposal = v ? proposeGl(v, l.description, gls) : null;
      return { ...l, proposal, gl_account_id: l.gl_account_id || proposal?.gl_account_id || "" };
    }));
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, ...patch };
    if (patch.description !== undefined && vendor) next.proposal = proposeGl(vendor, next.description, gls);
    return next;
  }));

  async function readUpload(file: File) {
    if (file.size > 4 * 1024 * 1024) return toast.error("That file is over 4 MB. Upload a smaller scan.");
    setUpload({ url: URL.createObjectURL(file), mime: file.type, name: file.name });
    setUploadState("reading");
    setUploadNote(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/ai/extract", { method: "POST", body: form });
      const out = await res.json() as { error?: string; note?: string; source?: string; invoice?: { isInvoice: boolean; vendor: string; invoiceNumber: string; invoiceDate: string; lineItems: { description: string; amount: number }[]; total: number; confidence: number; issues: string[] } };
      if (!res.ok) throw new Error(out.error ?? "The file couldn't be read");
      if (!out.invoice || out.source === "mock") {
        setUploadState("manual");
        setUploadNote(out.note ?? "No vision model is configured, so the invoice can't be read automatically.");
        setLines([blankLine()]);
        return;
      }
      const inv = out.invoice;
      const v = matchVendor(inv.vendor, vendors);
      const ex: ExtractedInvoice = { vendor: inv.vendor, invoice_number: inv.invoiceNumber, invoice_date: inv.invoiceDate, due_date: inv.invoiceDate ? addDays(inv.invoiceDate, 30) : addDays(today, 30), total: inv.total, lines: inv.lineItems, confidence: inv.confidence };
      setExtracted(ex);
      setExtractSource({ source: "live", model: out.source });
      setVendorId(v?.id ?? "");
      setInvoice(ex.invoice_number);
      if (/^\d{4}-\d{2}-\d{2}$/.test(ex.invoice_date)) { setBillDate(ex.invoice_date); setDueOn(ex.due_date); }
      setLines(toLines(ex.lines.length ? ex.lines : [{ description: "", amount: ex.total }], v, gls));
      setUploadState("read");
      setUploadNote(!inv.isInvoice ? "This doesn't look like an invoice. Check the fields before saving." : inv.issues.length ? inv.issues.join(" ") : null);
    } catch (e) {
      setUploadState("manual");
      setUploadNote(e instanceof Error ? e.message : "The file couldn't be read.");
      setLines([blankLine()]);
    }
  }

  const invalid = !vendor ? "Pick the vendor" : !property ? "Pick the property" : !invoice.trim() ? "Enter the invoice number" : !lines.length || lines.some((l) => !l.description.trim() || !l.gl_account_id || cents(l.amount) <= 0) ? "Every line needs a description, GL account and amount" : total <= 0 ? "The total must be more than zero" : null;

  async function submit() {
    if (invalid || !vendor || !property) return;
    setBusy("submit");
    try {
      let billId = item.kind === "bill" ? item.id : "";
      if (!billId) {
        const created = await post<{ row: { id: string } }>("/api/e/bills", { vendor_id: vendor.id, property_id: property.id, owner_entity_id: property.owner_entity_id, invoice_number: invoice.trim(), bill_date: billDate, due_on: dueOn, amount: total / 100, status: "Draft" });
        billId = created.row.id;
      }
      const r = await runBillAction(billId, "bills.submit", { lines: lines.map((l) => ({ description: l.description.trim(), gl_account_id: l.gl_account_id, amount: cents(l.amount) / 100 })) });
      setStage({ billId, status: "Pending approval" });
      toast.success(r.message ?? "Submitted for approval");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The bill wasn't saved");
    } finally {
      setBusy(null);
    }
  }

  async function act(kind: "approve" | "approve_and_pay" | "pay") {
    if (!stage) return;
    const r = await runBillAction(stage.billId, `bills.${kind}`);
    setStage({ billId: stage.billId, status: kind === "approve" ? "Approved" : "Scheduled" });
    toast.success(r.message ?? "Done", { action: { label: "View bill", onClick: () => router.push(`/app/payables/bills/${encodeURIComponent(stage.billId)}`) } });
    router.refresh();
  }

  const locked = !!stage;
  const docUrl = item.kind === "sample" ? item.file : item.kind === "bill" ? item.docUrl : upload?.url ?? null;
  const docMime = item.kind === "upload" ? upload?.mime ?? "" : docUrl?.endsWith(".pdf") ? "application/pdf" : "image/png";

  return (
    <div className="grid min-h-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_520px] xl:grid-cols-[minmax(0,1fr)_460px]">
      {/* Document */}
      <section aria-label="Invoice document" className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border bg-muted/30">
        {item.kind === "upload" && !upload ? (
          <UploadZone onFile={readUpload} />
        ) : docUrl ? (
          <DocumentViewer url={docUrl} mime={docMime} name={item.kind === "upload" ? upload?.name : undefined} reading={uploadState === "reading"} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <ScanLine className="size-6" />
            {item.kind === "bill" && item.docName ? <>
              <p className="font-medium text-foreground">Scanned invoice {item.docName}</p>
              <p className="max-w-xs text-[12.5px]">The original file isn&apos;t kept in this demo. The fields read from it are used in the checks on the right.</p>
            </> : <>
              <p className="font-medium text-foreground">No scan on file</p>
              <p className="max-w-xs text-[12.5px]">This bill was entered by hand or from a work order, so there&apos;s no invoice image to compare.</p>
            </>}
          </div>
        )}
      </section>

      {/* Bill */}
      <section aria-label="Bill" className="flex min-w-0 flex-col gap-3">
        <div className="rounded-lg border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
            <h2 className="text-[14px] font-semibold">{stage ? stage.billId : item.kind === "bill" ? item.id : "New bill"}</h2>
            <StatusBadge value={stage?.status ?? (item.kind === "bill" ? item.status : "Draft")} />
            {extractSource && extracted && (
              <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                Fields read from the invoice <AIBadge source={extractSource.source} model={extractSource.model} size="xs" />
                <Confidence value={extracted.confidence} />
              </span>
            )}
          </header>

          {uploadState === "reading" && (
            <div role="status" className="flex items-center gap-2 border-b bg-tone-ai/[0.05] px-3.5 py-2 text-[12.5px]"><Loader2 className="size-3.5 animate-spin text-tone-ai" />Reading the invoice: vendor, invoice number, dates and lines. This can take up to 30 seconds.</div>
          )}
          {uploadNote && (
            <div role="status" className="flex items-start gap-2 border-b bg-tone-warning/[0.07] px-3.5 py-2 text-[12.5px]"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-tone-warning" /><span>{uploadNote}{uploadState === "manual" ? " Enter the fields from the document on the left." : ""}</span></div>
          )}

          {item.kind === "upload" && uploadState === "idle" ? (
            <p className="px-3.5 py-8 text-center text-[12.5px] text-muted-foreground">Upload an invoice to start. The fields fill in from the document, and each line gets a suggested GL account.</p>
          ) : (
            <div className="flex flex-col gap-3 p-3.5">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <Field label="Vendor" className="col-span-2">
                  <select value={vendorId} disabled={locked} onChange={(e) => setVendor(e.target.value)} className={selectCls} aria-label="Vendor">
                    <option value="">{extracted?.vendor ? `No match for "${extracted.vendor}" — pick one` : "Pick a vendor"}</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.company} · {v.trade}</option>)}
                  </select>
                  {extracted?.vendor && vendor && <span className="text-[11px] text-muted-foreground">Matched from &ldquo;{extracted.vendor}&rdquo;</span>}
                </Field>
                <Field label="Property" className="col-span-2">
                  <select value={propertyId} disabled={locked} onChange={(e) => setPropertyId(e.target.value)} className={selectCls} aria-label="Property">
                    <option value="">Pick a property</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Invoice #"><Input value={invoice} disabled={locked} onChange={(e) => setInvoice(e.target.value)} name="invoice_number" autoComplete="off" /></Field>
                <Field label="Total"><div className="flex h-8 items-center justify-end rounded-lg border bg-muted/40 px-2.5 font-semibold"><Money value={total / 100} /></div></Field>
                <Field label="Bill date"><Input type="date" value={billDate} disabled={locked} onChange={(e) => setBillDate(e.target.value)} name="bill_date" /></Field>
                <Field label="Due"><Input type="date" value={dueOn} disabled={locked} onChange={(e) => setDueOn(e.target.value)} name="due_on" /></Field>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground">
                  <span className="flex-1">Lines and GL coding</span>
                  <Tooltip><TooltipTrigger asChild><span className="inline-flex items-center gap-1"><Sparkles className="size-3 text-tone-ai" />suggested coding</span></TooltipTrigger><TooltipContent className="max-w-64">Suggested from the vendor&apos;s past bills and its trade. You can change any account before saving.</TooltipContent></Tooltip>
                  <AIBadge source="rules" size="xs" />
                </div>
                <ol className="flex flex-col gap-2">
                  {lines.map((l, i) => {
                    const gl = gls.find((g) => g.id === l.gl_account_id);
                    const p = l.proposal;
                    const differs = p && l.gl_account_id && p.gl_account_id !== l.gl_account_id;
                    const pgl = p ? gls.find((g) => g.id === p.gl_account_id) : null;
                    return (
                      <li key={l.key} className="flex flex-col gap-1.5 rounded-md border bg-background p-2">
                        <div className="flex gap-1.5">
                          <Input value={l.description} disabled={locked} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description…" aria-label={`Line ${i + 1} description`} className="flex-1" />
                          <Input value={l.amount} disabled={locked} inputMode="decimal" onChange={(e) => setLine(i, { amount: e.target.value })} aria-label={`Line ${i + 1} amount`} className="w-28 text-right tabular-nums" />
                          {!locked && lines.length > 1 && <Button size="icon-sm" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select value={l.gl_account_id} disabled={locked} onChange={(e) => setLine(i, { gl_account_id: e.target.value })} className={cn(selectCls, "h-7 w-auto max-w-[260px] text-[12.5px]")} aria-label={`Line ${i + 1} GL account`}>
                            <option value="">GL account…</option>
                            {gls.map((g) => <option key={g.id} value={g.id}>{g.number} {g.name}</option>)}
                          </select>
                          {p && !differs && gl && (
                            <Tooltip>
                              <TooltipTrigger asChild><span tabIndex={0} className="inline-flex h-6 items-center gap-1 rounded-full bg-tone-ai/[0.08] px-2 text-[11px] text-tone-ai ring-1 ring-tone-ai/20 ring-inset"><Sparkles className="size-3" />Suggested · {Math.round(p.confidence * 100)}%</span></TooltipTrigger>
                              <TooltipContent className="max-w-72">{p.why.join(". ") || "From the vendor's trade."}</TooltipContent>
                            </Tooltip>
                          )}
                          {differs && pgl && (
                            <span className="inline-flex flex-wrap items-center gap-1 text-[11.5px] text-tone-warning">
                              <Sparkles className="size-3" />Usually {pgl.number} {pgl.name}
                              {!locked && <button type="button" onClick={() => setLine(i, { gl_account_id: p!.gl_account_id })} className="rounded px-1 font-medium text-primary hover:underline">Use it</button>}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {!locked && <Button size="sm" variant="ghost" className="self-start" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> Add line</Button>}
              </div>
            </div>
          )}
        </div>

        {(item.kind !== "upload" || uploadState !== "idle") && <ChecksPanel checks={checks} warnings={warnings} hold={!!stop} />}

        {stop && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-tone-danger/30 bg-tone-danger/[0.06] px-3.5 py-3">
            <AlertOctagon className="mt-0.5 size-4 shrink-0 text-tone-danger" />
            <div className="min-w-0 text-[12.5px]">
              <div className="font-semibold text-tone-danger">Payment hold: approval and payment are disabled</div>
              <p className="mt-0.5">{stop.detail}</p>
              {stage && <Link href={`/app/payables/bills/${encodeURIComponent(stage.billId)}?tab=review`} className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline">Record the phone verification on the bill <ArrowUpRight className="size-3" /></Link>}
            </div>
          </div>
        )}

        {/* Actions */}
        {(item.kind !== "upload" || uploadState !== "idle") && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3.5 py-2.5">
            {!stage ? (
              <>
                <Button onClick={() => void submit()} disabled={!!invalid || !!busy}>{busy === "submit" ? <Loader2 className="animate-spin" /> : <Send />}Save and submit for approval</Button>
                <span aria-live="polite" className="text-[12px] text-muted-foreground">{invalid ?? (warnings ? `${warnings} check${warnings > 1 ? "s" : ""} to review before approving` : "All checks pass")}</span>
              </>
            ) : stage.status === "Pending approval" ? (
              <>
                <Button disabled={!!stop} onClick={() => setConfirm("approve")}><BadgeCheck />Approve</Button>
                {canPay && <Button variant="outline" disabled={!!stop} onClick={() => setConfirm("approve_and_pay")}><CircleDollarSign />Approve and pay</Button>}
                <Link href={`/app/payables/bills/${encodeURIComponent(stage.billId)}`} className="ml-auto text-[12.5px] text-primary hover:underline">Open {stage.billId}</Link>
              </>
            ) : stage.status === "Approved" ? (
              <>
                {canPay && <Button disabled={!!stop} onClick={() => setConfirm("pay")}><CircleDollarSign />Pay by ACH</Button>}
                <Link href={`/app/payables/bills/${encodeURIComponent(stage.billId)}`} className="ml-auto text-[12.5px] text-primary hover:underline">Open {stage.billId}</Link>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 text-tone-success" />
                <span className="text-[12.5px]">{stage.billId} is {stage.status.toLowerCase()}.</span>
                <Link href={`/app/payables/bills/${encodeURIComponent(stage.billId)}`} className="ml-auto text-[12.5px] text-primary hover:underline">Open {stage.billId}</Link>
              </>
            )}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="default"
        title={confirm === "approve" ? "Approve this bill?" : confirm === "pay" ? "Send payment?" : "Approve and send payment?"}
        description={confirm === "approve"
          ? `${vendor?.company ?? "The vendor"}'s bill for $${(total / 100).toFixed(2)} becomes payable from ${property?.name ?? "the property"}'s trust account.`
          : `$${(total / 100).toFixed(2)} leaves ${property?.name ?? "the property"}'s trust account by ACH to ${vendor?.company ?? "the vendor"}. The trust balance must cover it, and each bill pays once.`}
        confirmLabel={confirm === "approve" ? "Approve" : "Send payment"}
        onConfirm={() => act(confirm!)}
      />
    </div>
  );
}

const selectCls = "h-8 w-full rounded-lg border border-input bg-background px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={cn("flex min-w-0 flex-col gap-1", className)}><span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function ChecksPanel({ checks, warnings, hold }: { checks: Check[]; warnings: number; hold: boolean }) {
  const icon = (c: Check) => c.level === "ok" ? <CheckCircle2 className="size-3.5 text-tone-success" /> : c.level === "warn" ? <TriangleAlert className="size-3.5 text-tone-warning" /> : <AlertOctagon className="size-3.5 text-tone-danger" />;
  return (
    <div className="rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-3.5 py-2">
        <h3 className="text-[13px] font-semibold">Payables checks</h3>
        <span className={cn("text-[11.5px]", hold ? "font-medium text-tone-danger" : "text-muted-foreground")}>{hold ? "Payment hold" : warnings ? `${warnings} to review` : "Nothing unusual"}</span>
        <AIBadge source="rules" size="xs" className="ml-auto" />
      </header>
      <ul className="divide-y">
        {checks.map((c) => (
          <li key={c.key} className={cn("flex gap-2 px-3.5 py-2", c.level === "stop" && "bg-tone-danger/[0.04]")}>
            <span className="mt-0.5">{icon(c)}</span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium">{c.label}</div>
              {c.level !== "ok" && <div className="text-[12px] text-muted-foreground">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UploadZone({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={cn("m-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors", over ? "border-primary bg-primary/[0.04]" : "border-border")}
    >
      <FileUp className="size-7 text-muted-foreground" />
      <div>
        <p className="font-medium">Drop an invoice here</p>
        <p className="text-[12.5px] text-muted-foreground">PDF, JPEG, PNG or WebP, up to 4 MB. The file is read and discarded; it isn&apos;t stored.</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => ref.current?.click()}>Choose a file</Button>
      <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" aria-label="Invoice file" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}

export function DocumentViewer({ url, mime, name, reading }: { url: string; mime: string; name?: string; reading?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const pdf = mime === "application/pdf";
  return (
    <>
      <div className="flex items-center gap-1 border-b bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{name ?? url.split("/").pop()}</span>
        {!pdf && <>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut /></Button>
          <button className="w-11 tabular-nums hover:text-foreground" onClick={() => setZoom(1)} aria-label="Fit to width">{Math.round(zoom * 100)}%</button>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}><ZoomIn /></Button>
        </>}
        <a href={url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 hover:text-foreground">Open <ArrowUpRight className="size-3" /></a>
      </div>
      <div className="relative flex-1 overflow-auto p-4">
        {pdf
          ? <object data={url} type="application/pdf" className="h-full min-h-[640px] w-full rounded border bg-white" aria-label="Invoice PDF" />
          // eslint-disable-next-line @next/next/no-img-element -- local sample or object URL; the Workers build has no image optimizer
          : <img src={url} alt="Scanned invoice" style={{ width: `${zoom * 100}%` }} className="mx-auto max-w-none rounded border bg-white shadow-sm" />}
        {reading && <div className="absolute inset-x-4 top-4 h-0.5 animate-pulse bg-tone-ai" aria-hidden />}
      </div>
    </>
  );
}

