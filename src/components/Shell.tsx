"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PERSONAS } from "@/lib/seed";
import { useDemo } from "@/lib/store";
import type { PersonaId } from "@/lib/types";
import { DemoSwitcher } from "./DemoSwitcher";
import { Badge } from "./ui";

export type Tab = { id: string; label: string; content: React.ReactNode };

export function useAiMode() {
  const [mode, setMode] = useState<{ source: string; label: string } | null>(null);
  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then(setMode)
      .catch(() => setMode({ source: "mock", label: "Mock data" }));
  }, []);
  return mode;
}

export function Shell({
  persona,
  tabs,
  tab: controlledTab,
  onTab,
  heading,
  back,
}: {
  persona: PersonaId;
  tabs: Tab[];
  tab?: string;
  onTab?: (id: string) => void;
  heading?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  const { state } = useDemo();
  const [ownTab, setOwnTab] = useState(tabs[0].id);
  const tab = controlledTab ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const [inboxOpen, setInboxOpen] = useState(false);
  const mode = useAiMode();
  const me = state.users.find((u) => u.id === PERSONAS[persona].userId)!;
  const inbox = state.notifications.filter((n) => n.userId === me.id);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="min-h-full bg-[#F6F2EA] text-[#1C1917]">
      {/* Outside the blurred header: backdrop-filter would trap a fixed child inside the pill. */}
      {inboxOpen && <button aria-label="Close inbox" className="fixed inset-0 z-[5] cursor-default" onClick={() => setInboxOpen(false)} />}
      <header className="sticky top-0 z-10 px-4 pt-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 rounded-full bg-[#FBF9F4]/80 p-1.5 pl-5 shadow-[0_8px_40px_-12px_rgba(28,25,23,0.18)] ring-1 ring-[#1C1917]/[0.06] backdrop-blur-xl">
          <Link href="/demo" className="font-serif text-2xl leading-none tracking-tight">Propniti</Link>
          <span className="ml-2 hidden sm:inline">
            <Badge tone={mode?.source === "mock" || !mode ? "amber" : "green"}>AI: {mode ? mode.label : "…"}</Badge>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setInboxOpen((o) => !o)}
                className="rounded-full px-3 py-2 text-[13px] text-[#44403C] hover:bg-[#1C1917]/[0.04]"
                aria-label="Messages received"
              >
                Inbox <span className="ml-1 rounded-full bg-[#1C1917] px-1.5 py-0.5 text-[11px] text-[#FBF9F4]">{inbox.length}</span>
              </button>
              {inboxOpen && (
                <div className="absolute right-0 z-10 mt-3 max-h-96 w-80 overflow-y-auto rounded-[1.5rem] bg-[#FFFDF8] p-4 shadow-[0_24px_60px_-20px_rgba(28,25,23,0.35)] ring-1 ring-[#1C1917]/[0.08]">
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#78716C]">Messages sent to {me.name}</div>
                  {inbox.length === 0 && <p className="text-sm text-[#78716C]">No messages.</p>}
                  {inbox.map((n) => (
                    <div key={n.id} className="border-b border-[#1C1917]/[0.06] py-2.5 text-sm last:border-0">
                      <div className="text-xs text-[#78716C]">{n.ts} · {n.channel}</div>
                      <div className="text-[#292524]">{n.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="hidden items-center gap-2 rounded-full py-1 pl-1 pr-3 sm:flex">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#8A6A45]/15 text-[11px] font-semibold text-[#6F5337]">
                {me.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </span>
              <span className="text-[13px] text-[#1C1917]">{me.name}</span>
            </div>
            <Link href="/login" className="rounded-full bg-[#1C1917] px-4 py-2 text-[13px] font-medium text-[#FBF9F4] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]">Sign out</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 pb-28 pt-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            {back && (
              <Link href={back.href} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-[#57534E] hover:text-[#1C1917]">
                <span aria-hidden>←</span> {back.label}
              </Link>
            )}
            <div />
            <span className="inline-flex rounded-full bg-[#1C1917]/[0.04] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[#57534E] ring-1 ring-[#1C1917]/[0.06]">
              {PERSONAS[persona].label}
            </span>
            <h1 className="mt-4 font-serif text-5xl leading-none tracking-[-0.01em]">
              {heading ?? (
                <>
                  Welcome, <em className="text-[#8A6A45]">{me.name.split(" ")[0]}.</em>
                </>
              )}
            </h1>
          </div>
          {tabs.length > 1 && (
            <nav className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-[#1C1917]/[0.04] p-1 ring-1 ring-[#1C1917]/[0.05]">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    t.id === active.id ? "bg-[#FFFDF8] text-[#1C1917] shadow-[0_2px_10px_-4px_rgba(28,25,23,0.25)]" : "text-[#78716C] hover:text-[#1C1917]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          )}
        </div>
        {active.content}
      </main>
      <DemoSwitcher persona={persona} />
    </div>
  );
}
