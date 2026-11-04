"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/ai/ui/client";

// The same setting and route as the Agents page (PATCH /api/ai/agents/<key>, audited).
export function AutonomySelect({ agent, name, value, options }: { agent: string; name: string; value: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const [level, setLevel] = useState(value);
  const save = async (next: string) => {
    const before = level;
    setLevel(next);
    try {
      await api(`/api/ai/agents/${agent}`, "PATCH", { autonomy: next });
      toast.success("Saved and logged to the audit trail");
      router.refresh();
    } catch (e) {
      setLevel(before);
      toast.error((e as Error).message);
    }
  };
  return (
    <Select value={level} onValueChange={(v) => void save(v)}>
      <SelectTrigger size="sm" className="h-7 w-[9.5rem] text-[12.5px]" aria-label={`Autonomy for ${name}`}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}
