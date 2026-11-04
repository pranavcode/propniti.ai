import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Small presentational pieces shared by the resident pages (server-safe, no hooks).

// Dates in the data are calendar days or UTC timestamps; format them in UTC so a due date of
// Nov 1 never shows as Oct 31 in a US time zone.
export const fmtDay = (d: string | null | undefined, year = false) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : "—";
// The seed writes appointment times as the property's local wall-clock time, so show them as stored.
export const fmtWhen = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "—";

const STEPS = ["Submitted", "Scheduled", "In progress", "Done"] as const;
const stepOf = (status: string) =>
  ["Completed", "Paid"].includes(status) ? 3 : status === "In progress" || status === "Submitted" ? 2 : ["Scheduled", "Assigned"].includes(status) ? 1 : 0;

// Where a request is: submitted → scheduled → in progress → done.
export function RequestTimeline({ status, openedAt, scheduledAt, completedAt, className }: { status: string; openedAt: string; scheduledAt: string | null; completedAt: string | null; className?: string }) {
  if (status === "Cancelled") return <p className={cn("text-[12px] text-muted-foreground", className)}>Cancelled</p>;
  const at = stepOf(status);
  const dates = [fmtDay(openedAt), scheduledAt ? fmtDay(scheduledAt) : "", "", completedAt ? fmtDay(completedAt) : ""];
  return (
    <ol className={cn("grid grid-cols-4 gap-1", className)} aria-label={`Status: ${STEPS[at]}`}>
      {STEPS.map((s, i) => (
        <li key={s} className="min-w-0">
          <div className={cn("h-1.5 rounded-full", i <= at ? "bg-primary" : "bg-muted")} />
          <p className={cn("mt-1 flex items-center gap-0.5 truncate text-[11px]", i <= at ? "font-medium text-foreground" : "text-muted-foreground")}>
            {i < at && <Check className="size-3 shrink-0 text-primary" aria-hidden />}{s}
          </p>
          {dates[i] && <p className="truncate text-[10.5px] text-muted-foreground tabular-nums">{dates[i]}</p>}
        </li>
      ))}
    </ol>
  );
}

export function Card({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-[0_1px_2px_oklch(0_0_0/0.04)] md:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-[14.5px] font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
