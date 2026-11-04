"use client";

import { useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { EXPORT_CAP, type Format } from "@/lib/export/types";

const BRAND_KEY = "pn_export_branding";

const ITEMS: { format: Format; label: string; hint: string; icon: typeof Table2 }[] = [
  { format: "csv", label: "CSV", hint: "Plain data. CSV has no branding.", icon: Table2 },
  { format: "xlsx", label: "Excel (.xlsx)", hint: "Numbers and dates stay numbers and dates", icon: FileSpreadsheet },
  { format: "pdf", label: "PDF", hint: "A printable table", icon: FileText },
];

const filenameOf = (res: Response, fallback: string) => res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallback;

// "Download" for a list, report or statement: CSV, Excel or PDF of what is on screen, built on the
// server under the same scope and filters. "Include Propniti branding" is remembered per browser.
export function DownloadMenu({ hrefs, total, label = "Download", what = "Downloads what's on screen: same filters, search, view and scope.", size = "sm" }: { hrefs: Record<Format, string>; total?: number; label?: string; what?: string; size?: "sm" | "default" }) {
  const [branded, setBranded] = useLocalStorage<boolean>(BRAND_KEY, true);
  const [busy, setBusy] = useState<Format | null>(null);

  const download = async (format: Format) => {
    const base = hrefs[format];
    const url = format === "csv" ? base : `${base}${base.includes("?") ? "&" : "?"}brand=${branded ? 1 : 0}`;
    setBusy(format);
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filenameOf(res, `export.${format}`);
      document.body.append(a);
      a.click();
      a.remove();
      // Revoking in the same tick can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={!!busy} aria-label={label}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          <span className="hidden md:inline">{busy ? "Preparing…" : label}</span>
          <ChevronDown className="hidden text-muted-foreground md:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[11.5px] font-normal text-muted-foreground">
          {total != null && total > EXPORT_CAP
            ? `Downloads the first ${EXPORT_CAP.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} rows. Narrow the filters to get the rest.`
            : what}
        </DropdownMenuLabel>
        {ITEMS.map((it) => (
          <DropdownMenuItem key={it.format} onSelect={() => void download(it.format)} className="items-start">
            <it.icon className="mt-0.5 text-muted-foreground" />
            <span className="flex flex-col">
              <span className="text-[13px]">{it.label}</span>
              <span className="text-[11.5px] text-muted-foreground">{it.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={branded} onCheckedChange={(v) => setBranded(v === true)} onSelect={(e) => e.preventDefault()} className="items-start">
          <span className="flex flex-col">
            <span className="text-[13px]">Include Propniti branding</span>
            <span className="text-[11.5px] text-muted-foreground">Excel and PDF: logo, scope, filters, time and a footer</span>
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
