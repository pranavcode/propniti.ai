import Link from "next/link";
import { Button } from "@/components/ui/button";

// Previous / next for portal lists; keeps the other query params.
export function Pager({ base, params, page, size, total }: { base: string; params: Record<string, string | undefined>; page: number; size: number; total: number }) {
  if (total <= size) return null;
  const href = (p: number) => `${base}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null) as [string, string][]), page: String(p) })}`;
  const last = Math.ceil(total / size);
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2 border-t px-3 py-2 text-[12.5px] text-muted-foreground">
      <span className="tabular-nums">{(page - 1) * size + 1}–{Math.min(page * size, total)} of {total.toLocaleString("en-US")}</span>
      <span className="flex gap-1.5">
        {page > 1 ? <Button asChild size="sm" variant="outline"><Link href={href(page - 1)}>Previous</Link></Button> : <Button size="sm" variant="outline" disabled>Previous</Button>}
        {page < last ? <Button asChild size="sm" variant="outline"><Link href={href(page + 1)}>Next</Link></Button> : <Button size="sm" variant="outline" disabled>Next</Button>}
      </span>
    </nav>
  );
}
