"use client";

import { AskBox } from "@/components/app/ai";
import { useAssistant } from "@/components/app/shell/context";

// The "Ask or tell Propniti…" box on Today: hands the question to the assistant dock (⌘J).
export function AskToday({ suggestions }: { suggestions: string[] }) {
  const assistant = useAssistant();
  return <AskBox onAsk={(q) => assistant.ask(q, { path: "/app/today" })} suggestions={suggestions} placeholder="Ask or tell Propniti… e.g. “Send reminders to residents 30+ days late at Barton Creek”" />;
}
