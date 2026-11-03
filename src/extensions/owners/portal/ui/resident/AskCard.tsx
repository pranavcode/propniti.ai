"use client";

import { Sparkles } from "lucide-react";
import { AskBox } from "@/components/app/ai";
import { askPortal } from "../PortalAssistant";

// The home page's AI help: questions go to the assistant panel, which answers from the resident's records.
export function AskCard({ prompts }: { prompts: string[] }) {
  return (
    <section className="rounded-xl border bg-card p-4 md:p-5" aria-labelledby="ask-title">
      <h2 id="ask-title" className="mb-1 flex items-center gap-2 text-[14.5px] font-semibold tracking-tight"><Sparkles className="size-4 text-tone-ai" />Need help?</h2>
      <p className="mb-3 text-[12.5px] text-muted-foreground">Ask about rent, repairs, your lease or renewal. Answers come from your account, and show what was looked up.</p>
      <AskBox onAsk={askPortal} suggestions={prompts} size="md" placeholder="Ask a question…" />
    </section>
  );
}
