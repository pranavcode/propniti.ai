"use client";

import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequestForm } from "./RequestForm";

// "New request" toggles the form through ?new=1, so the home page and the assistant can link to it.
export function NewRequest({ me, open }: { me: string; open: boolean }) {
  const router = useRouter();
  if (!open) return <Button onClick={() => router.replace("/portal/resident/requests?new=1", { scroll: false })}><Wrench />New request</Button>;
  return (
    <section className="rounded-xl border bg-card p-4 md:p-5" aria-labelledby="new-req">
      <h2 id="new-req" className="mb-4 text-[15px] font-semibold tracking-tight">New maintenance request</h2>
      <RequestForm me={me} onDone={() => router.replace("/portal/resident/requests", { scroll: false })} />
    </section>
  );
}
