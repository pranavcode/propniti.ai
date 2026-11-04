"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { Check, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortalAction } from "../usePortalAction";

// Asks the office about renewal options (one message a week per lease, sent to the renewal
// conversation in Messages).
export function AskRenewal({ me, asked }: { me: string; asked: boolean }) {
  const { run, busy } = usePortalAction("residents", me);
  const [done, setDone] = useState(asked);
  if (done) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Check className="size-3.5 text-tone-success" aria-hidden />You asked the office about renewing this week.
        <Link href="/portal/resident/messages" className="font-medium text-primary hover:underline">See the conversation</Link>
      </p>
    );
  }
  const ask = async () => {
    const r = await run("ask_renewal", {});
    if (r.ok || /already asked/i.test(r.message ?? "")) setDone(true);
  };
  return <Button size="sm" variant="outline" className="max-md:h-11" disabled={!!busy} onClick={ask}><MessageSquare data-icon="inline-start" />{busy ? "Sending…" : "Ask about renewing"}</Button>;
}
