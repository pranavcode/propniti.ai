"use client";

import Link from "@/components/Link";
import { History } from "lucide-react";
import { AskBox } from "@/components/app/ai";
import { RelativeDate } from "@/components/app/display";
import { useRecent } from "@/components/app/recent";
import { useAssistant, useBreadcrumbTitle } from "@/components/app/shell/context";
import { useMounted } from "@/hooks/use-mounted";

// Client parts of the home briefing: the big ask box (hands the question to the assistant dock)
// and recently viewed records (kept per browser).

export function BriefingAsk({ prompts }: { prompts: string[] }) {
  const { ask } = useAssistant();
  useBreadcrumbTitle("Briefing");
  return <AskBox onAsk={(q) => ask(q, { path: "/app" })} suggestions={prompts} placeholder="Ask or tell Propniti… e.g. “Draft reminders for residents 30+ days late in Austin”" footer={<span>Answers use your data and show every record they looked up. Actions wait for your approval.</span>} />;
}

export function RecentlyViewed() {
  const mounted = useMounted();
  const recent = useRecent();
  if (!mounted) return <div className="h-24 rounded-lg border bg-card" aria-hidden />;
  if (!recent.length) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-4 text-[12.5px] text-muted-foreground">
        <History className="size-4 shrink-0" />Records you open show up here, so you can get back to them in one click.
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {recent.slice(0, 6).map((r) => (
        <li key={r.href}>
          <Link href={r.href} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.title}</span>
              {r.subtitle && <span className="block truncate text-[12px] text-muted-foreground">{r.subtitle}</span>}
            </span>
            <RelativeDate value={r.at} className="shrink-0 text-[11.5px] text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
