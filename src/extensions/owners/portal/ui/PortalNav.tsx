"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, Building2, CalendarCheck, ClipboardList, CreditCard, FileCheck2, FileText, Home, Inbox, MessageSquare, Receipt, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PortalRole } from "@/entities/types";

type Item = { href: string; label: string; icon: LucideIcon };

// Each portal's sections. The first item is the portal home.
export const PORTAL_NAV: Record<PortalRole, Item[]> = {
  owner: [
    { href: "/portal/owner", label: "Overview", icon: Home },
    { href: "/portal/owner/statements", label: "Statements", icon: FileText },
    { href: "/portal/owner/approvals", label: "Approvals", icon: CalendarCheck },
    { href: "/portal/owner/properties", label: "Properties", icon: Building2 },
    { href: "/portal/owner/documents", label: "Documents", icon: FileCheck2 },
    { href: "/portal/owner/messages", label: "Messages", icon: MessageSquare },
  ],
  resident: [
    { href: "/portal/resident", label: "Home", icon: Home },
    { href: "/portal/resident/pay", label: "Pay", icon: CreditCard },
    { href: "/portal/resident/requests", label: "Requests", icon: Wrench },
    { href: "/portal/resident/lease", label: "Lease", icon: FileText },
    { href: "/portal/resident/messages", label: "Messages", icon: MessageSquare },
  ],
  vendor: [
    { href: "/portal/vendor", label: "Home", icon: Home },
    { href: "/portal/vendor/jobs", label: "Jobs", icon: ClipboardList },
    { href: "/portal/vendor/invoices", label: "Invoices", icon: Receipt },
    { href: "/portal/vendor/payments", label: "Payments", icon: Banknote },
    { href: "/portal/vendor/insurance", label: "Insurance", icon: ShieldCheck },
    { href: "/portal/vendor/messages", label: "Messages", icon: MessageSquare },
  ],
  applicant: [
    { href: "/portal/applicant", label: "Status", icon: Home },
    { href: "/portal/applicant/documents", label: "Documents", icon: Inbox },
    { href: "/portal/applicant/messages", label: "Messages", icon: MessageSquare },
  ],
};

const active = (path: string, href: string, home: string) => (href === home ? path === href : path === href || path.startsWith(href + "/"));

export function PortalNav({ role, badges = {} }: { role: PortalRole; badges?: Record<string, number> }) {
  const path = usePathname();
  const items = PORTAL_NAV[role];
  const home = items[0].href;
  return (
    <>
      <nav aria-label="Portal" className="hidden items-center gap-0.5 md:flex">
        {items.map((i) => {
          const on = active(path, i.href, home);
          return (
            <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
              className={cn("relative inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none", on && "bg-primary/[0.08] text-primary hover:bg-primary/[0.1] hover:text-primary")}>
              {i.label}
              {!!badges[i.href] && <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-semibold text-primary-foreground tabular-nums">{badges[i.href]}</span>}
            </Link>
          );
        })}
      </nav>
      {/* Phones: a bottom tab bar, the pattern residents and vendors know from banking apps. */}
      <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((i) => {
            const on = active(path, i.href, home);
            return (
              <li key={i.href}>
                <Link href={i.href} aria-current={on ? "page" : undefined} className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-muted-foreground", on && "text-primary")}>
                  <i.icon className="size-5" aria-hidden />
                  {i.label}
                  {!!badges[i.href] && <span className="absolute top-1.5 left-1/2 ml-2 size-2 rounded-full bg-primary" aria-label={`${badges[i.href]} new`} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
