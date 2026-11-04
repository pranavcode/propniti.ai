import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// The shell's top bar already shows the breadcrumb trail.
export function PageHeader({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

// Offset pager for custom pages: keeps every other query param.
export function Pager({ page, size, total, params, base }: { page: number; size: number; total: number; params: URLSearchParams; base: string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const href = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  return (
    <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
      <span className="tabular-nums">{from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
      <div className="flex items-center gap-1">
        <PagerLink href={href(page - 1)} disabled={page <= 1} label="Previous page"><ChevronLeft className="size-4" /></PagerLink>
        <span className="px-2 tabular-nums">Page {page} of {pages}</span>
        <PagerLink href={href(page + 1)} disabled={page >= pages} label="Next page"><ChevronRight className="size-4" /></PagerLink>
      </div>
    </div>
  );
}

function PagerLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const cls = cn("inline-flex size-7 items-center justify-center rounded-md border", disabled ? "pointer-events-none opacity-40" : "hover:bg-muted");
  return disabled ? <span aria-disabled className={cls} aria-label={label}>{children}</span> : <Link href={href} className={cls} aria-label={label} scroll={false}>{children}</Link>;
}

export const toParams = (sp: Record<string, string | string[] | undefined>) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) out.append(k, x);
  return out;
};
