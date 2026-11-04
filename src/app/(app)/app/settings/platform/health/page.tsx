import type { Metadata } from "next";
import Link from "@/components/Link";
import { Cpu, Database, Inbox, Timer } from "lucide-react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { modelInfo } from "@/ai/providers";
import { lastSweep } from "@/ai/orchestrator";
import { nextRun } from "@/ai/cron";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/display";
import { health } from "@/extensions/platform/console";
import { PlatformOnly } from "../gate";
import { agentName } from "@/ai/ui/labels";

export const metadata: Metadata = { title: "System health · Propniti" };
export const dynamic = "force-dynamic";

// The Cron Trigger in cloudflare.config.ts runs the agent sweep every 15 minutes.
const SWEEP = "*/15 * * * *";

function Tile({ icon, label, children, tone }: { icon: React.ReactNode; label: string; children: React.ReactNode; tone?: "success" | "warning" | "danger" | "neutral" }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground [&_svg]:size-3.5">{icon}{label}{tone && <StatusBadge value={tone === "success" ? "Healthy" : tone === "warning" ? "Check" : tone === "danger" ? "Down" : "Idle"} tone={tone === "neutral" ? "neutral" : tone} className="ml-auto" />}</div>
      {children}
    </div>
  );
}

const big = "text-[20px] font-semibold leading-none tracking-tight tabular-nums";
const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

export default async function HealthPage() {
  const session = await currentSession();
  if (session.actor.role !== "platform_admin") return <PlatformOnly />;
  const db = getPlatform().db;
  const [h, last] = await Promise.all([health(db), lastSweep(db)]);
  const now = h.checkedAt;
  const m = modelInfo();
  const next = nextRun(SWEEP, now);
  const sweepLate = last != null && now - last > 30 * 60_000;
  const queued = (h.runs.queued ?? 0) + (h.runs.running ?? 0);
  return (
    <>
      <PageHeader icon={<Cpu />} title="System health" description="What serves the AI, when the scheduled sweep last ran, what is waiting in the queues and how big the database is." meta={<span>Checked {formatDateTime(now)}</span>} />
      <PageBody>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Tile icon={<Cpu />} label="Model" tone={m.provider === "rules" ? "warning" : "success"}>
            <div className={big}>{m.label}</div>
            <p className="text-[12px] text-muted-foreground">{m.provider === "rules" ? "No model key or binding is configured, so agents run on deterministic rules and say so in their output." : `${m.provider} · ${m.model}${m.native ? " · native tool calling" : " · JSON plan loop"}`}</p>
          </Tile>
          <Tile icon={<Timer />} label="Scheduled sweep" tone={last == null ? "neutral" : sweepLate ? "warning" : "success"}>
            <div className={big}>{last ? formatRelative(last) : "Not run yet"}</div>
            <p className="text-[12px] text-muted-foreground">Every 15 minutes{next ? ` · next ${formatDateTime(next)}` : ""}{sweepLate ? " · more than 30 minutes late" : ""}</p>
          </Tile>
          <Tile icon={<Inbox />} label="Queues" tone={h.events.pending > 500 ? "warning" : "success"}>
            <div className={big}>{formatNumber(h.events.pending)}</div>
            <p className="text-[12px] text-muted-foreground">events waiting{h.events.oldest ? `, oldest ${formatRelative(h.events.oldest)}` : ""} · {formatNumber(queued)} runs queued or running · {formatNumber(h.runs.waiting_approval ?? 0)} waiting for approval · {formatNumber(h.needsYou)} proposals need a person</p>
          </Tile>
          <Tile icon={<Database />} label="Database" tone="success">
            <div className={big}>{h.bytes ? fmtBytes(h.bytes) : "Size not reported"}</div>
            <p className="text-[12px] text-muted-foreground">{formatNumber(h.workspaces.count)} visitor workspaces{h.workspaces.lastSeen ? `, last active ${formatRelative(h.workspaces.lastSeen)}` : ""}{h.bytes ? "" : ". D1 doesn't expose page counts here; row counts below."}</p>
          </Tile>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Section title="Largest tables" description="Rows across the shared base and every visitor overlay.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Table</th><th className="px-3 py-2 text-right font-medium">Rows</th><th className="px-3 py-2 text-right font-medium">In overlays</th></tr></thead>
                <tbody>{h.tables.map((t) => <tr key={t.table} className="border-t"><td className="px-3 py-1.5 font-mono text-[12px]">{t.table}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(t.rows)}</td><td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatNumber(t.overlay)}</td></tr>)}</tbody>
              </table>
            </div>
          </Section>
          <Section title="Recent failed runs" actions={<Link href="/app/ai/activity?status=failed" className="text-[12px] text-primary hover:underline">All runs</Link>}>
            {h.failed.length ? (
              <ul className="divide-y rounded-lg border">
                {h.failed.map((f) => (
                  <li key={f.id} className="px-3 py-2">
                    <Link href={`/app/ai/runs/${f.id}`} className="font-medium hover:text-primary hover:underline">{agentName(f.agent)}</Link>
                    <span className="ml-2 text-[12px] text-muted-foreground" title={formatDateTime(f.at)}>{formatRelative(f.at)}</span>
                    {f.error && <p className="mt-0.5 line-clamp-2 font-mono text-[11.5px] text-tone-danger">{f.error}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[12.5px] text-muted-foreground">No failed runs on record.</p>
            )}
          </Section>
        </div>
      </PageBody>
    </>
  );
}
