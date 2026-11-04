"use client";

import Link from "@/components/Link";
import { ArrowRight, Check, Compass, Keyboard, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/app/shell/context";
import { useSetupProgress } from "@/components/app/onboarding/SetupChecklist";
import { readLocal } from "@/hooks/use-local-storage";
import { useMounted } from "@/hooks/use-mounted";
import type { TourProgress } from "@/components/app/tour/types";

// /app/setup: the same checklist as the sidebar pill (same keys, same pn_setup storage), with the
// live state of each step from the server, plus the product tours and the shortcut sheet.

export function SetupView({ hints }: { hints: Record<string, string> }) {
  const { items, done, total, setDone } = useSetupProgress();
  const { data, startTour } = useShell();
  const mounted = useMounted();
  const next = items.find((i) => !i.done);
  const progress = mounted ? readLocal<Record<string, TourProgress>>("pn_tours", {}) : {};
  const pct = Math.round((done / total) * 100);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="checklist" className="flex flex-col gap-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="checklist" className="text-[15px] font-semibold tracking-tight">{done === total ? "Setup complete" : `${total - done} of ${total} steps left before you go live`}</h2>
            <span className="text-[12px] text-muted-foreground tabular-nums">{pct}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          {next && <p className="mt-2 text-[12.5px] text-muted-foreground">Next: <span className="text-foreground">{next.label}</span>. {next.description}</p>}
        </div>
        <ol className="divide-y overflow-hidden rounded-lg border bg-card">
          {items.map((i, n) => (
            <li key={i.key} className={cn("flex items-start gap-3 px-4 py-3.5", i === next && "bg-primary/[0.035]")}>
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums", i.done ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>
                {i.done ? <Check className="size-3.5" strokeWidth={3} /> : n + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn("font-medium", i.done && "text-muted-foreground")}>{i.label}</div>
                <div className="text-[12.5px] text-muted-foreground">{i.description}</div>
                {hints[i.key] && <div className="mt-1 text-[12px] text-foreground/80">{hints[i.key]}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {i.done ? (
                  <Button variant="ghost" size="sm" onClick={() => setDone(i.key, false)}><RotateCcw /> Reopen</Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setDone(i.key, true)}>Mark done</Button>
                    <Button asChild size="sm" variant={i === next ? "default" : "outline"}><Link href={i.href}>{i.cta}{i === next && <ArrowRight />}</Link></Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <aside className="flex flex-col gap-3">
        <section aria-labelledby="tours" className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Compass className="size-4 text-muted-foreground" />
            <h2 id="tours" className="font-semibold">Product tours</h2>
          </div>
          {data.tours.length ? (
            <ul className="divide-y">
              {data.tours.map((t) => {
                const p = progress[t.id];
                const status = p?.status === "Completed" ? "Completed" : p && p.step > 0 ? `Stopped at step ${p.step + 1} of ${t.steps.length}` : `${t.steps.length} steps`;
                return (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.title}</div>
                      <div className="text-[12px] text-muted-foreground">{status}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => startTour(t.id)}><Play />{p && p.status !== "Completed" && p.step > 0 ? "Resume" : p?.status === "Completed" ? "Replay" : "Start"}</Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">No tours for this role yet.</p>
          )}
          <p className="border-t px-4 py-2.5 text-[12px] text-muted-foreground">Tours also restart from Help in the top bar.</p>
        </section>
        <Link href="/app/setup/shortcuts" className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40">
          <Keyboard className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Keyboard shortcuts</div>
            <div className="text-[12px] text-muted-foreground">A printable sheet of every shortcut. Press ? anywhere for the quick view.</div>
          </div>
          <ArrowRight className="size-4 text-muted-foreground" />
        </Link>
      </aside>
    </div>
  );
}
