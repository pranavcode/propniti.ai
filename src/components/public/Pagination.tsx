import Link from "@/components/Link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Server-rendered page links (crawlable): first, last, and two either side of the current page.
export function Pagination({ page, total, size, hrefFor }: { page: number; total: number; size: number; hrefFor: (page: number) => string }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  const shown = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const btn = "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-[14px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav aria-label="Pages" className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <p className="text-[13px] text-muted-foreground tabular-nums">Showing {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total.toLocaleString("en-US")}</p>
      <ul className="flex flex-wrap items-center gap-1.5">
        <li>{page > 1 ? <Link href={hrefFor(page - 1)} rel="prev" className={cn(btn, "hover:bg-muted")}><ChevronLeft className="size-4" aria-hidden /><span className="sr-only">Previous page</span></Link> : <span className={cn(btn, "opacity-40")} aria-hidden><ChevronLeft className="size-4" /></span>}</li>
        {shown.map((p, i) => (
          <li key={p} className="flex items-center gap-1.5">
            {i > 0 && p - shown[i - 1] > 1 && <span className="px-1 text-muted-foreground" aria-hidden>…</span>}
            <Link href={hrefFor(p)} aria-current={p === page ? "page" : undefined} className={cn(btn, p === page ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{p}</Link>
          </li>
        ))}
        <li>{page < pages ? <Link href={hrefFor(page + 1)} rel="next" className={cn(btn, "hover:bg-muted")}><ChevronRight className="size-4" aria-hidden /><span className="sr-only">Next page</span></Link> : <span className={cn(btn, "opacity-40")} aria-hidden><ChevronRight className="size-4" /></span>}</li>
      </ul>
    </nav>
  );
}
