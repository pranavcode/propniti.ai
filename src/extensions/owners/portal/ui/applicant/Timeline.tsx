import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = { label: string; date: string | null; state: "done" | "current" | "todo" | "denied" };

// The application's path, vertical on phones and horizontal on wider screens.
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-6 sm:gap-1" aria-label="Application progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-start gap-3 sm:flex-col sm:gap-1.5" aria-current={s.state === "current" ? "step" : undefined}>
          <div className="flex items-center gap-1 sm:w-full">
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
              s.state === "done" && "border-primary bg-primary text-primary-foreground",
              s.state === "current" && "border-primary bg-primary/10 text-primary ring-4 ring-primary/10",
              s.state === "denied" && "border-tone-danger bg-tone-danger/10 text-tone-danger",
              s.state === "todo" && "bg-card text-muted-foreground")}>
              {s.state === "done" ? <Check className="size-3.5" aria-hidden /> : s.state === "denied" ? <X className="size-3.5" aria-hidden /> : i + 1}
            </span>
            {i < steps.length - 1 && <span className={cn("hidden h-0.5 flex-1 rounded-full sm:block", s.state === "done" ? "bg-primary" : "bg-muted")} aria-hidden />}
          </div>
          <div className="min-w-0">
            <p className={cn("text-[13px] leading-tight", s.state === "todo" ? "text-muted-foreground" : "font-medium", s.state === "denied" && "text-tone-danger")}>{s.label}</p>
            <p className="text-[11.5px] text-muted-foreground tabular-nums">{s.date ?? (s.state === "current" ? "In progress" : s.state === "todo" ? "Not yet" : "")}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
