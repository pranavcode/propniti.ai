"use client";

import type { ValidationResult } from "@/lib/types";

const ease = "ease-[cubic-bezier(0.32,0.72,0,1)]";

// Same double-bezel card as the marketing site: outer tray + inner plate.
export function Card({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[1.75rem] bg-[#1C1917]/[0.035] p-1.5 ring-1 ring-[#1C1917]/[0.05] ${className}`}>
      <div className="h-full rounded-[calc(1.75rem-0.375rem)] bg-[#FFFDF8] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_24px_60px_-34px_rgba(28,25,23,0.22)]">
        {(title || action) && (
          <div className="mb-4 flex items-center justify-between gap-3">
            {title && <h2 className="font-serif text-2xl leading-tight text-[#1C1917]">{title}</h2>}
            {action}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

const tones = {
  gray: "bg-[#1C1917]/[0.05] text-[#57534E]",
  green: "bg-[#5F7A4E]/10 text-[#4A6340]",
  amber: "bg-[#B7862F]/12 text-[#8A6420]",
  red: "bg-[#A4502F]/10 text-[#8E4327]",
  blue: "bg-[#8A6A45]/12 text-[#6F5337]",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function statusTone(status: string): Tone {
  if (["Paid", "Received", "Sent", "Active", "Approved"].includes(status)) return "green";
  if (["Overdue", "Changes requested"].includes(status)) return "red";
  if (["Due", "Renewal due", "Submitted", "Pending"].includes(status)) return "amber";
  if (["In progress", "Assigned"].includes(status)) return "blue";
  return "gray";
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-[#1C1917] text-[#FBF9F4] hover:bg-[#292524] disabled:bg-[#1C1917]/40",
    secondary: "bg-white/70 text-[#1C1917] ring-1 ring-inset ring-[#1C1917]/12 hover:bg-white disabled:text-[#A8A29E]",
    danger: "bg-white/70 text-[#8E4327] ring-1 ring-inset ring-[#A4502F]/30 hover:bg-[#A4502F]/5",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-full px-4 py-1.5 text-sm font-medium transition-[transform,background-color] duration-500 ${ease} active:scale-[0.97] disabled:cursor-not-allowed ${styles} ${className}`}
    />
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[1.5rem] bg-[#1C1917]/[0.035] p-1.5 ring-1 ring-[#1C1917]/[0.05]">
      <div className="h-full rounded-[calc(1.5rem-0.375rem)] bg-[#FFFDF8] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#78716C]">{label}</div>
        <div className="mt-2 font-sans text-[2rem] font-medium leading-none tracking-[-0.035em] tabular-nums text-[#1C1917]">{value}</div>
        {sub && <div className="mt-2 text-xs text-[#78716C]">{sub}</div>}
      </div>
    </div>
  );
}

export function Table({ head, rows, empty = "Nothing here yet." }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-[#78716C]">{empty}</p>;
  return (
    <div className="-mx-6 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#1C1917]/10 text-[10px] uppercase tracking-[0.16em] text-[#78716C]">
            {head.map((h) => (
              <th key={h} className="px-6 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#1C1917]/[0.06] last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-6 py-3 align-top text-[#44403C]">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SourceNote({ source, note }: { source: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge tone={source === "mock" ? "amber" : "blue"}>{source === "mock" ? "Mock AI" : source === "anthropic" ? "Claude" : "OpenAI"}</Badge>
      {note && <span className="text-[#8A6420]">{note}</span>}
    </div>
  );
}

export function ValidationCard({ v }: { v: ValidationResult }) {
  const pct = Math.round(v.confidence * 100);
  const tone: Tone = v.decision === "approve" ? "green" : v.decision === "reject" ? "red" : "amber";
  const bar = v.confidence >= 0.85 ? "bg-[#5F7A4E]" : v.confidence >= 0.6 ? "bg-[#B7862F]" : "bg-[#A4502F]";
  return (
    <div className="space-y-4 rounded-[1.25rem] bg-[#F6F2EA] p-5 ring-1 ring-[#1C1917]/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={tone}>Agent says: {v.decision}</Badge>
          <span className="text-sm text-[#44403C]">{v.summary}</span>
        </div>
        <SourceNote source={v.source} note={v.note} />
      </div>
      <div>
        <div className="flex items-end justify-between text-xs text-[#57534E]">
          <span className="uppercase tracking-[0.16em]">Confidence</span>
          <span className="font-sans text-2xl font-medium leading-none tracking-[-0.03em] tabular-nums text-[#1C1917]">{pct}%</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[#1C1917]/[0.07]">
          <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-xs text-[#78716C]">85%+ with no issues = one-tap approve. Below that, review the evidence. Every payment needs a human in V1.</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#4A6340]">Matched</div>
          <ul className="mt-2 space-y-1.5 text-sm text-[#44403C]">
            {v.matched.length ? v.matched.map((m) => <li key={m}>✓ {m}</li>) : <li className="text-[#A8A29E]">None</li>}
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#8E4327]">Issues</div>
          <ul className="mt-2 space-y-1.5 text-sm text-[#44403C]">
            {v.issues.length ? v.issues.map((m) => <li key={m}>✗ {m}</li>) : <li className="text-[#A8A29E]">None</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
