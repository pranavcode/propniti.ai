"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, toDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// A date field that reads "Nov 2, 2026" in every browser. A native date input shows the browser's
// locale (02/11/2026 on a day-first machine), which misreads US invoice and policy dates.
// Value and onChange use YYYY-MM-DD; `name` posts the same through a hidden input.
export function DateInput({ id, value, onChange, disabled, name, min, className, "aria-label": ariaLabel }: {
  id?: string; value: string; onChange: (v: string) => void; disabled?: boolean; name?: string; min?: string; className?: string; "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value) ?? undefined;
  const floor = toDate(min ?? null) ?? undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} aria-label={ariaLabel} className={cn("w-full justify-between font-normal tabular-nums", !value && "text-muted-foreground", className)}>
          {value ? formatDate(value, "always") : "Pick a date"}
          <CalendarDays className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      {name && <input type="hidden" name={name} value={value} />}
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={selected} defaultMonth={selected} timeZone="UTC" disabled={floor ? { before: floor } : undefined}
          onSelect={(d) => { if (d) { onChange(d.toISOString().slice(0, 10)); setOpen(false); } }} />
      </PopoverContent>
    </Popover>
  );
}
