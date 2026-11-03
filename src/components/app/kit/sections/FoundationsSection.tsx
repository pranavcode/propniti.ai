"use client";

import { Compass, Download, Keyboard, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDelta, formatMoney, formatNumber, formatPct, formatRelative } from "@/lib/format";
import { AskBox } from "../../ai/AskBox";
import { Kbd, Meter, Money, PersonAvatar, RelativeDate, StatusBadge, Thumb } from "../../display";
import { SetupChecklist } from "../../onboarding/SetupChecklist";
import { Section } from "../../page";
import { useShellMaybe } from "../../shell/context";
import { EmptyState, ErrorBanner } from "../../states";
import type { Tone } from "@/entities/types";

const TOKENS = [
  ["background", "Page"], ["card", "Card"], ["muted", "Muted"], ["border", "Border"], ["primary", "Primary · deep teal"],
  ["chart-1", "Chart 1"], ["chart-2", "Chart 2"], ["chart-3", "Chart 3"], ["chart-4", "Chart 4"], ["chart-5", "Chart 5"],
] as const;
const TONES: { tone: Tone; examples: string[] }[] = [
  { tone: "success", examples: ["Paid", "Occupied", "Active", "Approved"] },
  { tone: "warning", examples: ["Pending approval", "Notice", "Due soon", "Expiring"] },
  { tone: "danger", examples: ["Overdue", "Failed", "Eviction", "Past SLA"] },
  { tone: "info", examples: ["Scheduled", "In progress", "New", "Submitted"] },
  { tone: "neutral", examples: ["Draft", "Vacant", "Closed", "Dismissed"] },
  { tone: "ai", examples: ["AI-suggested", "Auto-handled"] },
];

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border bg-card ${className}`}>
      <div className="border-b px-3 py-2 text-[12px] font-medium text-muted-foreground">{title}</div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// Sample dates are relative to page load; read once, outside render.
const now = Date.now();

export function FoundationsSection() {
  const shell = useShellMaybe();
  return (
    <div className="flex flex-col gap-8">
      <Section id="foundations" title="Foundations" description="Neutral greys, one deep-teal accent, Geist with tabular numbers, 6px radius, 13px body, 36px rows. Status colour is reserved for status.">
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title="Colour tokens" className="lg:col-span-2">
            <div className="grid grid-cols-5 gap-2">
              {TOKENS.map(([t, label]) => (
                <div key={t} className="flex flex-col gap-1">
                  <div className="h-10 rounded-md ring-1 ring-border ring-inset" style={{ background: `var(--${t})` }} />
                  <div className="text-[11.5px] leading-tight">{label}<div className="font-mono text-[10.5px] text-muted-foreground">--{t}</div></div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Type scale">
            <div className="flex flex-col gap-1.5">
              <div className="text-[20px] font-semibold tracking-[-0.01em]">Page title 20</div>
              <div className="text-[14px] font-semibold tracking-tight">Section title 14</div>
              <div>Body 13 · The Lofts at Riverside has 9 units on notice.</div>
              <div className="text-[12px] text-muted-foreground">Secondary 12 · Updated 3 minutes ago</div>
              <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Label 11</div>
              <div className="text-[24px] font-semibold tracking-tight tabular-nums">$1,248,930.00</div>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Buttons and keys">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => toast.success("Payment recorded", { description: "$1,840.00 from Jordan Lee · Unit 412", action: { label: "Undo", onClick: () => toast("Payment reversed") } })}>Record payment</Button>
          <Button variant="outline"><Plus /> New work order</Button>
          <Button variant="secondary"><Download /> Export</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive"><Trash2 /> Delete</Button>
          <Button size="sm">Approve 3 bills</Button>
          <Button size="sm" variant="outline">Small</Button>
          <Button size="icon-sm" variant="ghost" aria-label="Search"><Search /></Button>
          <span className="mx-2 h-5 w-px bg-border" />
          <span className="flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          <span className="flex items-center gap-1"><Kbd>G</Kbd><Kbd>P</Kbd></span>
          <Kbd>?</Kbd>
          <span className="mx-2 h-5 w-px bg-border" />
          <Button size="sm" variant="outline" onClick={() => shell?.openShortcuts()}><Keyboard /> Shortcuts</Button>
          <Button size="sm" variant="outline" onClick={() => shell?.startTour()}><Compass /> Start tour</Button>
          <Button size="sm" variant="outline" onClick={() => shell?.assistant.ask("Which leases expire next month without a renewal offer?")}><Sparkles /> Ask about this</Button>
        </div>
      </Section>

      <Section title="Status badges" description="One mapping everywhere (toneFor). Sentence case, tinted pill, darker text.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TONES.map((t) => (
            <div key={t.tone} className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-2.5">
              <span className="w-16 font-mono text-[11px] text-muted-foreground">{t.tone}</span>
              {t.examples.map((e) => <StatusBadge key={e} value={e} />)}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Numbers, money and dates" description="src/lib/format.ts. Money right-aligned and tabular; compact on KPIs, full in tables; relative dates only in feeds, with the exact time on hover.">
        <div className="grid gap-3 md:grid-cols-3">
          <Card title="Money">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
              <dt className="text-muted-foreground">Full</dt><dd className="text-right"><Money value={12450} /></dd>
              <dt className="text-muted-foreground">Negative</dt><dd className="text-right"><Money value={-1240} /></dd>
              <dt className="text-muted-foreground">Accounting</dt><dd className="text-right"><Money value={-1240} style="accounting" /></dd>
              <dt className="text-muted-foreground">Compact (KPI)</dt><dd className="text-right tabular-nums">{formatMoney(1_240_000, "compact")}</dd>
              <dt className="text-muted-foreground">Zero</dt><dd className="text-right"><Money value={0} /></dd>
            </dl>
          </Card>
          <Card title="Numbers">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 tabular-nums">
              <dt className="text-muted-foreground">Units</dt><dd className="text-right">{formatNumber(3312)}</dd>
              <dt className="text-muted-foreground">Compact</dt><dd className="text-right">{formatNumber(148_200, { compact: true })}</dd>
              <dt className="text-muted-foreground">Occupancy</dt><dd className="text-right">{formatPct(0.953)}</dd>
              <dt className="text-muted-foreground">Delta</dt><dd className="text-right text-tone-success">{formatDelta(468, 447)}</dd>
              <dt className="text-muted-foreground">Meter</dt><dd className="flex justify-end"><Meter value={0.91} /></dd>
            </dl>
          </Card>
          <Card title="Dates">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 tabular-nums">
              <dt className="text-muted-foreground">This year</dt><dd className="text-right">{formatDate("2026-03-14")}</dd>
              <dt className="text-muted-foreground">Other year</dt><dd className="text-right">{formatDate("2025-11-04")}</dd>
              <dt className="text-muted-foreground">Feed</dt><dd className="text-right"><RelativeDate value={now - 3 * 3600_000} /></dd>
              <dt className="text-muted-foreground">Due</dt><dd className="text-right"><RelativeDate value={new Date(now - 2 * 86_400_000).toISOString().slice(0, 10)} mode="due" /></dd>
              <dt className="text-muted-foreground">Soon</dt><dd className="text-right"><RelativeDate value={new Date(now + 3 * 86_400_000).toISOString().slice(0, 10)} mode="due" /></dd>
            </dl>
            <p className="mt-2 text-[11.5px] text-muted-foreground" suppressHydrationWarning>Relative: {formatRelative(now - 26 * 3600_000)}</p>
          </Card>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border bg-card px-3 py-2.5">
          <span className="flex items-center gap-2"><PersonAvatar name="Marcus Bell" /><PersonAvatar name="Priya Shah" /><PersonAvatar name="Zoë Ødegaard" /><PersonAvatar name="Grace Kim" size={32} /></span>
          <span className="flex items-center gap-2"><Thumb src="/img/props/p01-400.webp" size={32} /><Thumb src="/img/props/p08-400.webp" size={32} /><Thumb size={32} /></span>
        </div>
      </Section>

      <Section id="states" title="Empty, loading and error states" description="First use explains what will appear and offers the first action; filtered-to-nothing offers Clear filters. Skeletons, not spinners.">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border bg-card"><EmptyState kind="table" title="No work orders yet" description="Requests from residents and inspections land here. Create one, or import from your old system." action={{ label: "New work order", onClick: () => {} }} secondary={{ label: "Import CSV", onClick: () => {} }} /></div>
          <div className="rounded-lg border bg-card"><EmptyState kind="filtered" title="No matching residents" description="Try adjusting or clearing the filters." action={{ label: "Clear filters", onClick: () => {} }} /></div>
          <div className="rounded-lg border bg-card"><EmptyState kind="inbox" title="Inbox zero" description="Nothing needs you. Agents handled 14 items overnight." /></div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <ErrorBanner title="Payouts paused for Bluebonnet Fund II" message="The operating account needs a verified routing number before owner distributions can run." action={{ label: "Verify account", href: "/app/banking" }} />
            <ErrorBanner tone="warning" title="Bank feed is 2 days behind" message="Chase trust ••4410 last synced Nov 2. Reconciliation may show unmatched deposits." onRetry={() => toast("Retrying sync…")} />
          </div>
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-3"><Skeleton className="size-8 rounded-md" /><div className="flex-1 flex flex-col gap-1.5"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-1/2" /></div></div>
            <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-24 w-full" />
          </div>
        </div>
      </Section>

      <Section id="onboarding" title="Onboarding and the assistant entry" description="Setup checklist (sidebar pill opens it), product tour (Help → Restart tour), and the large Ask box used on home and in the dock.">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-4"><SetupChecklist /></div>
          <div className="flex flex-col justify-center gap-3 rounded-lg border bg-gradient-to-b from-primary/[0.03] to-transparent p-5">
            <div>
              <div className="text-[18px] font-semibold tracking-tight">Good morning, Marcus</div>
              <p className="text-muted-foreground">Agents handled 23 items overnight. 6 need you: 3 bills over limit, 2 renewals, 1 vendor bank change.</p>
            </div>
            <AskBox onAsk={(q) => (shell ? shell.assistant.ask(q) : toast(q))} suggestions={["Who is late on rent?", "Which leases expire next month without a renewal offer?", "What needs my approval today?"]} />
          </div>
        </div>
      </Section>
    </div>
  );
}
