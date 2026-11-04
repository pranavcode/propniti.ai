"use client";

import { Sparkles } from "lucide-react";
import { AskBox } from "@/components/app/ai";
import { askPortal } from "./PortalAssistant";

// Inline "Ask" card for portal home pages; answers open in the AI help panel.
export function PortalAsk({ title, prompts, placeholder = "Ask a question about your account…" }: { title: string; prompts: string[]; placeholder?: string }) {
  return (
    <section aria-label={title} className="rounded-xl border bg-card p-4">
      <p className="mb-2.5 flex items-center gap-1.5 text-[14px] font-semibold"><Sparkles className="size-4 text-tone-ai" />{title}</p>
      <AskBox onAsk={askPortal} suggestions={prompts} size="md" placeholder={placeholder} />
      <p className="mt-2 text-[11px] text-muted-foreground">Answers come from your own records and show what was looked up.</p>
    </section>
  );
}
