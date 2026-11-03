"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "../display";
import type { ShellNavSection } from "./types";

// "g <key>" go-to shortcuts. A target is used only when it is in this persona's sidebar.
export const GOTO: { key: string; label: string; match: (href: string, navKey: string) => boolean }[] = [
  { key: "h", label: "Home", match: (h) => h === "/app" },
  { key: "i", label: "Inbox", match: (h) => h === "/app/inbox" },
  { key: "t", label: "My tasks", match: (h) => h === "/app/tasks" },
  { key: "p", label: "Properties", match: (_, k) => k === "properties" },
  { key: "u", label: "Units", match: (_, k) => k === "units" },
  { key: "r", label: "Residents", match: (_, k) => k === "residents" },
  { key: "l", label: "Leases", match: (_, k) => k === "leases" },
  { key: "w", label: "Work orders", match: (_, k) => k === "work_orders" },
  { key: "b", label: "Bills", match: (_, k) => k === "bills" },
  { key: "a", label: "Approvals", match: (h) => h === "/app/ai/approvals" },
  { key: "d", label: "Data health", match: (h) => h === "/app/data-health" },
  { key: "s", label: "Settings", match: (h) => h === "/app/settings" },
];

export function gotoTargets(nav: ShellNavSection[]) {
  const items = nav.flatMap((s) => s.items);
  return GOTO.flatMap((g) => {
    const item = items.find((i) => g.match(i.href, i.key));
    return item ? [{ ...g, href: item.href }] : [];
  });
}

const GENERAL: [string[], string][] = [
  [["⌘", "K"], "Search and commands"],
  [["⌘", "J"], "Ask Propniti (assistant)"],
  [["⌘", "B"], "Collapse sidebar"],
  [["?"], "Show keyboard shortcuts"],
  [["/"], "Focus table search"],
];
const TABLE: [string[], string][] = [
  [["J"], "Next row"],
  [["K"], "Previous row"],
  [["↵"], "Open row"],
  [["X"], "Select row"],
  [["Esc"], "Clear selection"],
];

export function ShortcutsDialog({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (o: boolean) => void; nav: ShellNavSection[] }) {
  const go = gotoTargets(nav);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Work without the mouse. Shortcuts pause while you type in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Group title="General" rows={GENERAL} />
          <Group title="Go to" rows={go.map((g) => [["G", g.key.toUpperCase()], g.label] as [string[], string])} />
          <Group title="Tables" rows={TABLE} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, rows }: { title: string; rows: [string[], string][] }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="divide-y">
        {rows.map(([keys, label]) => (
          <li key={label} className="flex h-8 items-center justify-between gap-3">
            <span>{label}</span>
            <span className="flex items-center gap-1">{keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
