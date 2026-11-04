"use client";

import Link from "@/components/Link";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// First-run org setup checklist (plan addendum: company, bank, import, team, roles, payments).
// Progress is kept in localStorage behind useSetupProgress; lane C can back it with the server.

export type SetupItem = { key: string; label: string; description: string; href: string; cta: string; done?: boolean };

export const SETUP_ITEMS: SetupItem[] = [
  { key: "company", label: "Company profile", description: "Legal name, EIN, logo and business address.", href: "/app/settings/company", cta: "Edit profile", done: true },
  { key: "bank", label: "Connect trust and operating banks", description: "Link the accounts rent and owner payouts move through.", href: "/app/banking", cta: "Connect bank", done: true },
  { key: "import", label: "Import properties and units", description: "Upload a rent roll; the AI maps columns and flags bad rows.", href: "/app/settings/import", cta: "Import", done: true },
  { key: "roles", label: "Review roles and permissions", description: "Who can approve bills, post fees and see owner data.", href: "/app/settings/roles", cta: "Review roles", done: true },
  { key: "team", label: "Invite your team", description: "Property managers, leasing, accounting and maintenance.", href: "/app/settings/users?new=1", cta: "Invite", done: false },
  { key: "payments", label: "Set payment and late-fee rules", description: "Grace period, fee caps by state, and approval limits.", href: "/app/settings/payments", cta: "Set rules", done: false },
];

export function useSetupProgress(items: SetupItem[] = SETUP_ITEMS) {
  const [overrides, setOverrides] = useLocalStorage<Record<string, boolean>>("pn_setup", {});
  const list = items.map((i) => ({ ...i, done: overrides[i.key] ?? !!i.done }));
  const done = list.filter((i) => i.done).length;
  return { items: list, done, total: list.length, setDone: (key: string, v: boolean) => setOverrides((o) => ({ ...o, [key]: v })) };
}

function Ring({ value, size = 16 }: { value: number; size?: number }) {
  const r = (size - 3) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round" className="transition-[stroke-dashoffset] duration-500" />
    </svg>
  );
}

// Sidebar pill: "Finish setup 4/6" with a progress ring. Hidden once everything is done.
export function SetupPill({ collapsed, onClick }: { collapsed?: boolean; onClick: () => void }) {
  const { done, total } = useSetupProgress();
  if (done === total) return null;
  const btn = (
    <button data-tour="setup" onClick={onClick} className={cn("flex items-center gap-2 rounded-md text-[12.5px] transition-colors hover:bg-sidebar-accent", collapsed ? "size-8 justify-center" : "h-8 w-full border border-sidebar-border bg-background px-2 shadow-xs")}>
      <Ring value={done / total} />
      {!collapsed && <><span className="flex-1 text-left font-medium">Finish setup</span><span className="text-[11px] text-muted-foreground tabular-nums">{done}/{total}</span></>}
    </button>
  );
  return collapsed ? <Tooltip><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent side="right">Finish setup · {done}/{total}</TooltipContent></Tooltip> : btn;
}

export function SetupChecklist({ items: given, onNavigate, className }: { items?: SetupItem[]; onNavigate?: () => void; className?: string }) {
  const { items, done, total, setDone } = useSetupProgress(given);
  const next = items.find((i) => !i.done);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-3">
        <Ring value={done / total} size={34} />
        <div className="min-w-0">
          <div className="font-medium">{done === total ? "Setup complete" : `${total - done} steps left to go live`}</div>
          <div className="text-[12px] text-muted-foreground">{done} of {total} done · most teams finish in under an hour</div>
        </div>
      </div>
      <ol className="divide-y overflow-hidden rounded-lg border">
        {items.map((i) => (
          <li key={i.key} className={cn("flex items-start gap-3 px-3 py-2.5", i === next && "bg-primary/[0.035]")}>
            <button onClick={() => setDone(i.key, !i.done)} aria-label={i.done ? `Mark ${i.label} not done` : `Mark ${i.label} done`} className={cn("mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors", i.done ? "border-primary bg-primary text-primary-foreground" : "border-input hover:border-primary")}>
              {i.done && <Check className="size-3" strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className={cn("font-medium", i.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{i.label}</div>
              <div className="text-[12px] text-muted-foreground">{i.description}</div>
            </div>
            {!i.done && (
              <Link href={i.href} onClick={onNavigate} className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium", i === next ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border hover:bg-muted")}>
                {i.cta}{i === next && <ArrowRight className="size-3" />}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
