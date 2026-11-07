import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Journey, Step } from "../journeys";

// The portal's step trackers (server-safe, no hooks). JourneySteps is the full path, one row per
// step with its date, owner and meaning; JourneyBar is the compact strip used on cards.

const fmt = (d: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;

function Dot({ step, n }: { step: Step; n: number }) {
  return (
    <span className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-[11.5px] font-semibold tabular-nums",
      step.state === "done" && "border-primary bg-primary text-primary-foreground",
      step.state === "current" && "border-primary bg-card text-primary ring-4 ring-primary/15",
      step.state === "stopped" && "border-tone-danger bg-tone-danger/10 text-tone-danger",
      step.state === "todo" && "bg-card text-muted-foreground")}>
      {step.state === "done" ? <Check className="size-3.5" aria-hidden /> : step.state === "stopped" ? <X className="size-3.5" aria-hidden /> : n}
    </span>
  );
}

const STATE_LABEL: Record<Step["state"], string> = { done: "Done", current: "Now", todo: "Not yet", stopped: "Stopped" };

// `action` renders inside the current step, under "You need to", so the button sits where the
// person is reading.
export function JourneySteps({ journey, label, action, className }: { journey: Journey; label: string; action?: React.ReactNode; className?: string }) {
  const { steps, next } = journey;
  const finished = !steps.some((s) => s.state === "current" || s.state === "stopped");
  return (
    <div className={className}>
    <ol className="relative" aria-label={label}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const date = fmt(s.date);
        return (
          <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0" aria-current={s.state === "current" ? "step" : undefined} data-state={s.state}>
            {!last && <span aria-hidden className={cn("absolute top-7 bottom-0 left-[13px] w-0.5", s.state === "done" ? "bg-primary" : "bg-border")} />}
            <Dot step={s} n={i + 1} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className={cn("text-[14px] leading-tight", s.state === "todo" ? "text-muted-foreground" : "font-semibold", s.state === "stopped" && "text-tone-danger")}>
                  {s.label}<span className="sr-only">: {STATE_LABEL[s.state]}</span>
                </p>
                <p className="text-[12px] text-muted-foreground tabular-nums">{date ?? (s.state === "current" ? "Now" : "")}</p>
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <span className={cn("mr-1.5 inline-flex h-[18px] items-center rounded-full px-1.5 text-[11px] font-medium", s.owner === "You" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{s.owner}</span>
                {s.state !== "current" && s.detail}
              </p>
              {s.state === "current" || s.state === "stopped" ? (
                <div className={cn("mt-2.5 rounded-lg border p-3", s.state === "stopped" ? "border-tone-danger/25 bg-tone-danger/[0.05]" : "border-primary/20 bg-primary/[0.04]")}>
                  <p className="text-[13.5px] font-semibold">{next.title}</p>
                  <p className="mt-0.5 text-[13px] text-pretty text-muted-foreground">{next.body}</p>
                  {next.you && (
                    <p className="mt-2 flex items-start gap-1.5 text-[13px] font-medium"><ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /><span><span className="sr-only">You need to: </span>{next.you}</span></p>
                  )}
                  {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
    {finished && (
      <div className="mt-4 rounded-lg border border-tone-success/25 bg-tone-success/[0.06] p-3" role="status">
        <p className="text-[13.5px] font-semibold">{next.title}</p>
        <p className="mt-0.5 text-[13px] text-pretty text-muted-foreground">{next.body}</p>
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    )}
    </div>
  );
}

// Compact: a bar per step. Wider screens label every step; phones name only where it is now.
export function JourneyBar({ journey, label, className }: { journey: Journey; label: string; className?: string }) {
  const steps = journey.steps;
  // Name where it is: the stopped step, else the last one reached.
  const stopped = steps.findIndex((s) => s.state === "stopped");
  const at = stopped >= 0 ? stopped : Math.max(0, steps.map((s) => s.state).lastIndexOf("done"));
  const cur = steps[at];
  const n = at + 1;
  const all = steps.every((s) => s.state === "done");
  return (
    <div className={className}>
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={`${label}: ${all ? "done" : cur.label}`}>
        {steps.map((s) => (
          <li key={s.key} className="min-w-0" data-state={s.state}>
            <div className={cn("h-1.5 rounded-full", s.state === "done" ? "bg-primary" : s.state === "current" ? "bg-primary/40" : s.state === "stopped" ? "bg-tone-danger" : "bg-muted")} />
            <p className={cn("mt-1 hidden truncate text-[11px] sm:block", s.state === "todo" ? "text-muted-foreground" : "font-medium text-foreground", s.state === "stopped" && "text-tone-danger")}>{s.label}</p>
            {fmt(s.date) && <p className="hidden truncate text-[10.5px] text-muted-foreground tabular-nums sm:block">{fmt(s.date)}</p>}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[12px] sm:hidden" aria-hidden>
        <span className={cn("font-medium", cur.state === "stopped" && "text-tone-danger")}>{all ? "All done" : cur.label}</span>
        <span className="text-muted-foreground"> · step {n} of {steps.length}</span>
      </p>
    </div>
  );
}
