"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/app/display";
import { useShell } from "@/components/app/shell/context";
import { gotoTargets } from "@/components/app/shell/shortcuts";

// Every shortcut the app binds (AppShell, DataTable, RecordPage, notes and inline edit), grouped
// for printing. "Go to" lists only the pages in this persona's sidebar, like the ? dialog.

type Row = [keys: string[], label: string];

const SEARCH_AI: Row[] = [
  [["⌘", "K"], "Search records and run commands"],
  [["⌘", "J"], "Open or close the assistant"],
  [["/"], "Focus the table search (opens search elsewhere)"],
  [["?"], "Show the shortcuts dialog"],
  [["⌘", "B"], "Collapse or expand the sidebar"],
];
const TABLES: Row[] = [
  [["J"], "Next row"],
  [["K"], "Previous row"],
  [["↵"], "Open the highlighted row"],
  [["X"], "Select the highlighted row"],
  [["Esc"], "Clear the selection, then the highlight"],
];
const RECORDS: Row[] = [
  [["["], "Previous record in the list"],
  [["]"], "Next record in the list"],
  [["↵"], "Save an inline edit"],
  [["Esc"], "Cancel an inline edit"],
  [["⌘", "↵"], "Post a note"],
  [["@"], "Mention a teammate in a note"],
];

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="break-inside-avoid rounded-lg border bg-card print:border-black/20">
      <h2 className="border-b px-4 py-2.5 text-[13px] font-semibold">{title}</h2>
      <ul className="divide-y">
        {rows.map(([keys, label]) => (
          <li key={label} className="flex min-h-9 items-center justify-between gap-3 px-4 py-1.5">
            <span>{label}</span>
            <span className="flex shrink-0 items-center gap-1">{keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ShortcutSheet() {
  const { data } = useShell();
  const go: Row[] = gotoTargets(data.nav).map((g) => [["G", g.key.toUpperCase()], g.label]);
  return (
    <div id="shortcut-sheet" className="flex flex-col gap-4">
      {/* Print only the sheet, not the app frame around it. */}
      <style>{"@media print { body * { visibility: hidden; } #shortcut-sheet, #shortcut-sheet * { visibility: visible; } #shortcut-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 24px; } }"}</style>
      <h1 className="hidden text-[18px] font-semibold print:block">Propniti keyboard shortcuts</h1>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className="text-[12.5px] text-muted-foreground">On Windows and Linux, use Ctrl where you see ⌘. Shortcuts pause while you type in a field.</p>
        <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
      </div>
      <div className="columns-1 gap-4 space-y-4 md:columns-2 print:columns-2">
        <Group title="Search and AI" rows={SEARCH_AI} />
        <Group title="Navigation" rows={go.length ? go : [[["G", "H"], "Home"]]} />
        <Group title="Tables" rows={TABLES} />
        <Group title="Records" rows={RECORDS} />
      </div>
    </div>
  );
}
