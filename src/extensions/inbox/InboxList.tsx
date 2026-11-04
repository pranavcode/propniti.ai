"use client";

import Link from "next/link";
import { Bell, MessageSquare, ShieldCheck } from "lucide-react";
import { AIBadge, Confidence, RiskBadge, type Risk } from "@/components/app/ai";
import { Money, RelativeDate } from "@/components/app/display";
import { PeekLink } from "@/components/app/peek/PeekLink";
import { Button } from "@/components/ui/button";
import { AGENT_LABEL } from "@/ai/ui/client";
import { cn } from "@/lib/utils";
import type { InboxItem } from "./data";

// Inbox rows: who or what, the AI line where one exists, and the one action that clears the item.
// Titles open the record peek drawer; the action button goes to the page that does the work.

const KIND = {
  message: { icon: MessageSquare, label: "Message" },
  approval: { icon: ShieldCheck, label: "Approval" },
  alert: { icon: Bell, label: "Alert" },
} as const;

export function InboxList({ items }: { items: InboxItem[] }) {
  return (
    <ol className="divide-y overflow-hidden rounded-lg border bg-card" aria-label="Inbox items">
      {items.map((it) => {
        const k = KIND[it.kind];
        const title = it.who ? <><span className={cn(it.unread ? "font-semibold" : "font-medium")}>{it.who}</span><span className="text-muted-foreground"> · </span>{it.title}</> : it.title;
        return (
          <li key={`${it.kind}:${it.id}`} data-kind={it.kind} className={cn("flex items-start gap-3 px-3 py-2.5 md:px-4", it.unread && "bg-primary/[0.03]")}>
            <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground" title={k.label}>
              <k.icon className="size-3.5" aria-hidden />
              {it.unread && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-card" aria-label="Unread" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px]">
                {it.peek ? (
                  <PeekLink entity={it.peek.entity} id={it.peek.id} href={it.peek.href} className={cn("min-w-0 truncate outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50", it.unread && !it.who && "font-semibold")}>{title}</PeekLink>
                ) : <span className={cn("min-w-0 truncate", it.unread && !it.who && "font-semibold")}>{title}</span>}
                {it.risk && <RiskBadge risk={it.risk as Risk} />}
                {it.amountCents != null && <Money value={it.amountCents} cents className="text-[12.5px] font-medium" />}
              </div>
              {it.ai ? (
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                  <AIBadge source={it.ai.source} model={it.ai.model} size="xs" />
                  <span className="min-w-0 flex-1 truncate"><span className="text-muted-foreground">{it.ai.label}: </span>{it.ai.text}</span>
                  {it.ai.confidence != null && <Confidence value={it.ai.confidence} />}
                </div>
              ) : it.detail ? <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{it.kind === "message" ? "Last message: " : ""}{it.detail}</p> : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']">
                <span>{it.kind === "approval" && it.agent ? AGENT_LABEL[it.agent] ?? it.agent : k.label}</span>
                {it.kind === "message" && <span className={cn(it.needsReply && "font-medium text-foreground")}>{it.needsReply ? "Needs reply" : `Waiting on ${it.party ?? "them"}`}{it.unread ? " · unread" : ""}</span>}
                {it.property && <span>{it.property}</span>}
                <span><RelativeDate value={it.at} /></span>
              </p>
            </div>
            {it.action && (
              <Button asChild size="sm" variant={it.kind === "alert" ? "ghost" : "outline"} className="mt-0.5 shrink-0">
                <Link href={it.action.href} aria-label={`${it.action.label}: ${it.who ? `${it.who}, ` : ""}${it.title}`}>{it.action.label}</Link>
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
