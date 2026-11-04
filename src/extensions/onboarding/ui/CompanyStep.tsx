"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { US_STATES } from "../state";
import { ContinueButton, type StepProps } from "./Onboarding";

export function CompanyStep({ data, state, footer, complete }: StepProps) {
  const [name, setName] = useState(state.company?.name ?? data.defaultName);
  const [states, setStates] = useState<string[]>(state.company?.states ?? []);
  const [size, setSize] = useState(state.company?.size == null ? "" : String(state.company.size));
  const sizeNum = size.trim() === "" ? null : Number(size.replace(/,/g, ""));
  const badSize = sizeNum != null && (!Number.isInteger(sizeNum) || sizeNum < 0 || sizeNum > 1_000_000);
  const toggle = (s: string) => setStates((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
  const submit = () => complete({ company: { name: name.trim(), states: US_STATES.filter((s) => states.includes(s)), size: sizeNum } });

  return (
    <>
      <form className="flex flex-col gap-5 px-4 py-5 sm:px-5" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !badSize) void submit(); }}>
        <div className="grid gap-1.5 sm:max-w-md">
          <label htmlFor="onb-name" className="text-[13px] font-medium">Company name</label>
          <Input id="onb-name" name="name" autoComplete="organization" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-[13px] font-medium">States you operate in</legend>
          <p className="-mt-1 text-[12.5px] text-muted-foreground">Late-fee caps, notice periods and deposit rules follow these. {states.length ? `${states.length} selected.` : "Pick all that apply."}</p>
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-9 xl:grid-cols-[repeat(17,minmax(0,1fr))]">
            {US_STATES.map((s) => {
              const on = states.includes(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => toggle(s)}
                  className={cn("h-8 rounded-md border text-[12px] font-medium tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50", on && "border-primary bg-primary/[0.08] text-primary hover:bg-primary/[0.12]")}>
                  {s}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-1.5 sm:max-w-xs">
          <label htmlFor="onb-size" className="text-[13px] font-medium">Units managed <span className="font-normal text-muted-foreground">(optional)</span></label>
          <Input id="onb-size" name="size" inputMode="numeric" autoComplete="off" placeholder="About how many…" aria-invalid={badSize || undefined} aria-describedby="onb-size-help" value={size} onChange={(e) => setSize(e.target.value)} />
          <p id="onb-size-help" className={cn("text-[12px]", badSize ? "text-tone-danger" : "text-muted-foreground")}>{badSize ? "Enter a whole number, for example 420." : "Used to size the suggested rules if you skip the import."}</p>
        </div>
        <button type="submit" hidden />
      </form>
      {footer(<ContinueButton onClick={() => void submit()} disabled={!name.trim() || badSize}>Save and continue</ContinueButton>)}
    </>
  );
}
