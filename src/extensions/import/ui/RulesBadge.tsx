import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

// Provenance for work done by fixed rules (deterministic code), next to AIBadge for model output.
export function RulesBadge({ className }: { className?: string }) {
  return (
    <span title="Done by fixed rules in code, not a model." className={cn("inline-flex h-[18px] shrink-0 items-center gap-1 rounded bg-muted px-1 text-[10.5px] font-medium whitespace-nowrap text-muted-foreground ring-1 ring-border ring-inset", className)}>
      <Cpu className="size-3" aria-hidden />Rules
    </span>
  );
}
