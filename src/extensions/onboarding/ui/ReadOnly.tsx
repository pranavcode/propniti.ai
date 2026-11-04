import Link from "@/components/Link";
import { Lock } from "lucide-react";
import { STEPS } from "../state";

const WHAT: Record<string, string> = {
  company: "Company name, the states you operate in and portfolio size.",
  data: "Exports from AppFolio, Buildium, Yardi, Rent Manager, Propertyware, DoorLoop, TenantCloud, Entrata or a spreadsheet, identified and imported with a preview and undo.",
  rules: "Approval limits and agent autonomy sized from your own records; each suggestion is accepted, edited or kept.",
  team: "People, their roles and the properties they cover.",
  check: "Data Health runs over the imported records, then a summary of what's set up.",
};

// What /app/onboarding shows roles that don't set up the org.
export function ReadOnly({ who, title }: { who: string[]; title: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-4 rounded-lg border bg-card p-5">
      <p className="flex items-start gap-2 text-[13px]"><Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><span>Setting up the portfolio is done by a {who.slice(0, -1).join(", ")} or {who.at(-1)}. As {title.toLowerCase()}, you can see what it covers; the setup itself is read-only for you.</span></p>
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
            <div><div className="text-[13px] font-medium">{s.label}</div><div className="text-[12.5px] text-muted-foreground">{WHAT[s.key]}</div></div>
          </li>
        ))}
      </ol>
      <p className="text-[12.5px] text-muted-foreground">Switch role from your avatar menu to try it, or go back to <Link href="/app" className="text-primary hover:underline">your home</Link>.</p>
    </div>
  );
}
