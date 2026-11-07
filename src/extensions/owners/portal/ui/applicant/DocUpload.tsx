"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SAMPLE_DOCS, sampleFile, sampleForDocType, type SampleDocKey } from "../../sample-files";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const day = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// One document: received (with date) or needed, an upload, and "Try a sample file", which loads the
// demo's fictional sample for this document type. Sending posts the file to the upload route, which
// checks its size and type and files it on the application.
export function DocUpload({ type, received, hint, optional }: { type: string; received: { name: string; uploaded_at: string } | null; hint: string; optional?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sample, setSample] = useState<SampleDocKey | null>(null);
  const [busy, setBusy] = useState<"sample" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sampleKey = sampleForDocType(type);
  const id = `doc-${type.replace(/\W+/g, "-").toLowerCase()}`;

  const choose = (f: File | null, key: SampleDocKey | null = null) => {
    setError(null);
    if (f && f.type && !TYPES.includes(f.type)) return setError("Upload a PDF or a photo (JPEG, PNG or WebP).");
    if (f && f.size > MAX_BYTES) return setError("That file is over 4 MB. Upload a smaller scan or photo.");
    setFile(f);
    setSample(key);
  };
  const clear = () => { setFile(null); setSample(null); setError(null); if (input.current) input.current.value = ""; };

  const send = async () => {
    if (!file) return;
    setBusy("send");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("docType", type);
      if (sample) form.append("sample", sample);
      const res = await fetch("/portal/applicant/documents/upload", { method: "POST", body: form });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(out.error ?? "That didn't go through. Try again."); return; }
      toast.success(out.message ?? `${type} received`);
      clear();
      router.refresh();
    } catch {
      toast.error("You seem to be offline. Nothing was sent.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-doc={type}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {received ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-tone-success" aria-hidden /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">{type}{optional && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">Optional</span>}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {file ? <span className="inline-flex items-center gap-1 text-foreground"><FileText className="size-3.5" aria-hidden />{file.name} · {size(file.size)}{sample && <span className="ml-1 rounded bg-tone-warning/15 px-1 text-[10.5px] font-semibold tracking-wide text-tone-warning">SAMPLE</span>}</span>
              : received ? `Received ${day(received.uploaded_at)} · ${received.name}` : hint}
          </p>
          {error && <p role="alert" className="mt-1 text-[12px] text-tone-danger">{error}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-8 sm:justify-end sm:pl-0">
        {!file && <span className={received ? "inline-flex h-5 items-center rounded-full bg-tone-success/10 px-2 text-[11.5px] font-medium text-tone-success" : optional ? "inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11.5px] font-medium text-muted-foreground" : "inline-flex h-5 items-center rounded-full bg-tone-warning/10 px-2 text-[11.5px] font-medium text-tone-warning"}>{received ? "Received" : optional ? "If asked" : "Needed"}</span>}
        <input ref={input} id={id} type="file" accept={TYPES.join(",")} className="hidden" aria-label={`Choose a file for ${type}`} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        {file ? (
          <>
            <Button size="sm" variant="ghost" className="max-md:h-10" onClick={clear} disabled={!!busy}>Cancel</Button>
            <Button size="sm" className="max-md:h-10" disabled={!!busy} onClick={send}>{busy === "send" ? <><Loader2 className="animate-spin" data-icon="inline-start" />Sending…</> : "Send"}</Button>
          </>
        ) : (
          <>
            {sampleKey && (
              <Button size="sm" variant="ghost" className="text-primary max-md:h-10" disabled={!!busy} aria-label={`Try a sample file for ${type}`} onClick={async () => {
                setBusy("sample");
                try { choose(await sampleFile(SAMPLE_DOCS[sampleKey].file, SAMPLE_DOCS[sampleKey].name), sampleKey); } catch (e) { setError(e instanceof Error ? e.message : "The sample didn't load."); } finally { setBusy(null); }
              }}>{busy === "sample" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}Try a sample file</Button>
            )}
            <Button size="sm" variant={received || optional ? "outline" : "default"} className="max-md:h-10" onClick={() => input.current?.click()}><Upload data-icon="inline-start" />{received ? "Replace" : "Upload"}</Button>
          </>
        )}
      </div>
    </li>
  );
}
