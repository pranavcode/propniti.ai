"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bell, Building2, Gauge, Globe, History, KeyRound, Landmark, Percent, Plug, ShieldCheck, Sparkles, Upload, Users, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBreadcrumbTitle } from "@/components/app/shell/context";
import type { SettingsGroup } from "../nav";

const ICONS: Record<string, LucideIcon> = { building: Building2, users: Users, key: KeyRound, plug: Plug, upload: Upload, shield: ShieldCheck, landmark: Landmark, percent: Percent, workflow: Workflow, sparkles: Sparkles, history: History, bell: Bell, globe: Globe, gauge: Gauge, activity: Activity };

// Longest matching href wins, so /app/settings/platform/usage doesn't also light up "Customer orgs".
export function SettingsNav({ groups }: { groups: SettingsGroup[] }) {
  const path = usePathname();
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const active = hrefs.filter((h) => path === h || path.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  // Section pages name themselves in the breadcrumb ("AI settings", not the path's "Ai"); record
  // pages below a section set their own title.
  useBreadcrumbTitle(path === active ? groups.flatMap((g) => g.items).find((i) => i.href === active)?.label : null);
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto px-4 pt-4 md:sticky md:top-0 md:max-h-[calc(100dvh-3rem)] md:w-56 md:shrink-0 md:flex-col md:gap-4 md:overflow-y-auto md:border-r md:px-3 md:py-5">
      <Link href="/app/settings" className={cn("hidden px-2 text-[15px] font-semibold tracking-tight md:block", path === "/app/settings" && "text-primary")}>Settings</Link>
      {groups.map((g) => (
        <div key={g.label} className="flex shrink-0 gap-1 md:flex-col md:gap-0.5">
          <div className="hidden px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:block">{g.label}</div>
          {g.items.map((i) => {
            const Icon = ICONS[i.icon] ?? Building2;
            const on = i.href === active;
            return (
              <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
                className={cn("flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                <Icon className="size-4 shrink-0" />{i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
