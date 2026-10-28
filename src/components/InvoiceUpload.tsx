"use client";

import { useState } from "react";
import { money } from "@/lib/mockAi";
import type { ExtractResult, ExtractedInvoice } from "@/lib/types";
import { Badge, Button, SourceNote } from "./ui";

// Reads an invoice image or PDF with the configured vision model and hands the result back.
export function InvoiceUpload({ onApply, applyLabel = "Use these line items" }: { onApply: (inv: ExtractedInvoice) => void; applyLabel?: string }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setResult(null);
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    if (file.size > 4 * 1024 * 1024) return setError("File too large (max 4 MB).");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ai/extract", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Upload failed.");
      else setResult(json as ExtractResult);
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const inv = result?.invoice;
  const passed = result?.checks.filter((c) => c.ok).length ?? 0;
  return (
    <div className="space-y-4 rounded-[1.25rem] bg-[#F6F2EA] p-5 ring-1 ring-[#1C1917]/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#78716C]">Read an invoice with AI</div>
          <p className="mt-1 text-sm text-[#57534E]">Photo or PDF of the invoice or bill, up to 4 MB. It is read and discarded, not stored.</p>
          <p className="mt-1 text-xs text-[#78716C]">
            No invoice handy? Try a sample: <a className="underline underline-offset-4" href="/samples/coolair-invoice.png" download>clean</a> ·{" "}
            <a className="underline underline-offset-4" href="/samples/coolair-invoice-bad.png" download>with problems</a>
          </p>
        </div>
        <label className={`inline-flex cursor-pointer items-center rounded-full px-4 py-1.5 text-sm font-medium ${busy ? "bg-[#1C1917]/40 text-[#FBF9F4]" : "bg-[#1C1917] text-[#FBF9F4] hover:bg-[#292524]"}`}>
          {busy ? "Reading…" : "Upload invoice"}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {error && <p className="text-sm text-[#8E4327]">{error}</p>}
      {(preview || result) && (
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          {preview ? <img src={preview} alt="Uploaded invoice" className="w-40 rounded-xl ring-1 ring-[#1C1917]/10" /> : <div />}
          {result && (
            <div className="space-y-3 text-sm">
              <SourceNote source={result.source} note={result.note} />
              {inv && (
                <>
                  <div className="text-[#44403C]">
                    <span className="font-medium text-[#1C1917]">{inv.vendor || "Unknown vendor"}</span> · invoice {inv.invoiceNumber || "—"} · {inv.invoiceDate || "no date"}
                  </div>
                  <ul className="space-y-1">
                    {inv.lineItems.map((li, i) => (
                      <li key={i} className="flex justify-between gap-3 tabular-nums"><span>{li.description}</span><span>{money(li.amount)}</span></li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-[#1C1917]/10 pt-1 font-medium tabular-nums"><span>Stated total</span><span>{money(inv.total)}</span></li>
                  </ul>
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={passed === result.checks.length ? "green" : "amber"}>{passed}/{result.checks.length} checks passed</Badge>
                      <span className="text-xs tabular-nums text-[#78716C]">legibility {Math.round(inv.confidence * 100)}%</span>
                    </div>
                    <ul className="space-y-0.5 text-[13px]">
                      {result.checks.map((c) => <li key={c.label} className={c.ok ? "text-[#4A6340]" : "text-[#8E4327]"}>{c.ok ? "✓" : "✗"} {c.label}</li>)}
                      {inv.issues.map((i) => <li key={i} className="text-[#8E4327]">✗ {i}</li>)}
                    </ul>
                  </div>
                  <Button onClick={() => onApply(inv)} disabled={!inv.isInvoice || inv.lineItems.length === 0}>{applyLabel}</Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
