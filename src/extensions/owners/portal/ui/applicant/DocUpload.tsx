"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CircleDashed, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortalAction } from "../usePortalAction";

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const day = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// One required document: received (with date) or needed, with an upload button either way.
export function DocUpload({ me, type, received, hint }: { me: string; type: string; received: { name: string; uploaded_at: string } | null; hint: string }) {
  const { run, busy } = usePortalAction("applicants", me);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const id = `doc-${type.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {received ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-tone-success" aria-hidden /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">{type}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {file ? `${file.name} · ${size(file.size)}` : received ? `Received ${day(received.uploaded_at)} · ${received.name}` : hint}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-8 sm:justify-end sm:pl-0">
        <span className={received ? "inline-flex h-5 items-center rounded-full bg-tone-success/10 px-2 text-[11.5px] font-medium text-tone-success" : "inline-flex h-5 items-center rounded-full bg-tone-warning/10 px-2 text-[11.5px] font-medium text-tone-warning"}>{received ? "Received" : "Needed"}</span>
        <input ref={input} id={id} type="file" accept="application/pdf,image/*" className="hidden" aria-label={`Choose a file for ${type}`} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setFile(null); if (input.current) input.current.value = ""; }}>Cancel</Button>
            <Button size="sm" disabled={!!busy} onClick={async () => {
              const r = await run("upload_document", { docType: type, fileName: file.name.slice(0, 120) });
              if (r.ok) { setFile(null); if (input.current) input.current.value = ""; }
            }}>{busy ? "Sending…" : "Send"}</Button>
          </>
        ) : (
          <Button size="sm" variant={received ? "outline" : "default"} onClick={() => input.current?.click()}><Upload />{received ? "Replace" : "Upload"}</Button>
        )}
      </div>
    </li>
  );
}
