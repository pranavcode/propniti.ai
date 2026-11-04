"use client";
import { demoNow } from "@/lib/clock";

import { Banknote, Bot, HeartPulse, KeyRound, ReceiptText, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { AIBadge, AISuggestion, AISummaryCard, AgentCard, ApprovalItem, AskBox, DataHealthBadge, FixPreview, RunTrace, type TraceStep } from "../../ai";
import { Section } from "../../page";

const wait = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const now = demoNow().getTime();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const ahead = (min: number) => new Date(now + min * 60_000).toISOString();

const STEPS: TraceStep[] = [
  { idx: 0, kind: "plan", ok: true, at: ago(6), latencyMs: 820, tokens: 412, summary: "Find Austin residents 30+ days late with no payment plan, draft reminders, propose late fees within the Texas cap" },
  { idx: 1, kind: "tool_call", toolKey: "charges.list_overdue", ok: true, at: ago(6), input: { scope: ["p01", "p02", "p03"], minDaysLate: 30, excludePaymentPlans: true } },
  { idx: 2, kind: "tool_result", toolKey: "charges.list_overdue", ok: true, at: ago(6), latencyMs: 143, summary: "14 leases, $38,420.17 overdue", output: { total: 14, amountCents: 3842017, rows: [{ lease: "L-p01-0412", resident: "Jordan Lee", unit: "412", daysLate: 34, balance: 2140.0 }, { lease: "L-p02-0108", resident: "Aisha Okafor", unit: "108", daysLate: 61, balance: 4280.5 }] } },
  { idx: 3, kind: "tool_call", toolKey: "state_rules.late_fee_cap", ok: true, at: ago(5), input: { state: "TX", units: 186 } },
  { idx: 4, kind: "tool_result", toolKey: "state_rules.late_fee_cap", ok: true, at: ago(5), latencyMs: 38, summary: "Texas: 12% of monthly rent for ≤4 units, 10% above", output: { capPct: 10, graceDays: 2 } },
  { idx: 5, kind: "reasoning_summary", ok: true, at: ago(5), latencyMs: 1290, tokens: 1184, summary: "3 residents already have a fee posted this month; 2 have open hardship notes. Skip those 5; propose fees for 9." },
  { idx: 6, kind: "tool_call", toolKey: "messages.draft", ok: false, at: ago(4), latencyMs: 4020, summary: "messages.draft timed out on 1 of 9 drafts; retried", input: { template: "late-rent-reminder", language: "auto" } },
  { idx: 7, kind: "proposal", toolKey: "charges.post_late_fee", ok: true, at: ago(4), latencyMs: 61, summary: "Proposed: post 9 late fees ($1,284.00) and send 14 reminders", output: { proposalId: "prop-7f21", amountCents: 128400, needsApproval: true } },
];

export function AISection() {
  return (
    <Section id="ai" title="AI surfaces" description="Restrained, labelled honestly: live model, saved result or rule fallback. Every suggestion shows why, how sure, and what it looked at. People approve anything that moves money.">
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <AIBadge source="live" model="Workers AI · llama-3.3-70b" />
            <AIBadge source="precomputed" />
            <AIBadge source="rules" />
            <DataHealthBadge issues={0} />
            <DataHealthBadge issues={[{ id: "i1", rule: "leases.rent_outlier", severity: "critical", summary: "Rent $18,950 is 10× the unit's market rent" }, { id: "i2", rule: "residents.phone_in_email", severity: "warn", summary: "Phone number in the email field" }]} onFix={() => toast("Opening the fix preview")} />
          </div>

          <AskBox onAsk={(q) => toast(`Asked: ${q}`)} suggestions={["Who is late on rent?", "Which leases expire next month without a renewal offer?", "What needs my approval today?"]} footer={<>Answers come from your data · actions wait for your approval</>} />

          <AISuggestion
            title={<>Suggested: <b>Plumbing</b> · <b>Urgent</b> · assign <b>Lone Star Plumbing</b> ($180 est.)</>}
            why={["Photo shows water staining on the ceiling below unit 412", "3 similar leaks at this building in 90 days, all plumbing", "Lone Star has a 96% on-time rate here and is under the $500 owner limit"]}
            confidence={0.88}
            evidence={[{ label: "WO-2291", href: "/app/maintenance/work-orders/wo-2291" }, { label: "Unit 412", href: "/app/units/p01-412" }, { label: "Lone Star Plumbing", href: "/app/vendors/v01" }]}
            source="live" model="llama-3.3-70b" generatedAt={ago(3)}
            acceptLabel="Assign vendor" onAccept={() => wait()} onEdit={() => toast("Edit triage")} onReject={() => wait(300)}
          />

          <div className="flex flex-col gap-2">
            <ApprovalItem
              agent="Payables agent" title="Approve bill from ABC HVAC · INV-88213" amount={2140} risk="High"
              why={["Amount is 2.4× this vendor's median for a service call", "Vendor bank details changed 6 days ago, not yet verified", "Matches PO-1182 for the rooftop unit at Uptown Tower"]}
              evidence={[{ label: "INV-88213", href: "/app/payables/bills/b-88213" }, { label: "PO-1182" }, { label: "Bank change log" }]}
              confidence={0.62} policy="Over the $1,500 approval limit · needs a principal or accountant" runHref="/app/ai/activity?run=run-31" createdAt={ago(42)} canApprove={false}
              onApprove={() => wait()} onReject={() => wait()} onEdit={() => {}}
            />
            <div className="overflow-hidden rounded-lg border bg-card">
              <ApprovalItem variant="row" agent="Collections agent" title="Send 14 late-rent reminders (EN/ES)" risk="Low" why={["All 14 are 30+ days late with no payment plan", "Drafts use the approved template; 3 in Spanish by resident preference"]} confidence={0.93} createdAt={ago(12)} runHref="/app/ai/activity?run=run-29" onApprove={() => wait()} onReject={() => wait()} />
              <ApprovalItem variant="row" agent="Collections agent" title="Post 9 late fees in Austin" amount={1284} risk="Medium" why={["Within the Texas 10% cap after the 2-day grace period", "Skipped 5 residents: fee already posted or a hardship note"]} confidence={0.86} createdAt={ago(12)} onApprove={() => wait()} onReject={() => wait()} />
              <ApprovalItem variant="row" agent="Renewals agent" title="Offer renewal at $1,945 (+3.2%) to Maya Patel, #208" amount={1945} risk="Low" why={["Comparable 1-beds leased at $1,960–$2,010 last 60 days", "On-time payer for 26 months; renewal likelihood 81%"]} confidence={0.81} createdAt={ago(95)} onApprove={() => wait()} onReject={() => wait()} />
            </div>
          </div>

          <FixPreview
            title="Lease rent looks like a typo" rule="leases.rent_outlier"
            changes={[{ field: "rent", label: "Monthly rent", before: "$18,950.00", after: "$1,895.00" }]}
            why={["Unit market rent is $1,880; every other lease at this floor plan is $1,820–$1,960", "Ledger charges for the last 3 months were posted at $1,895.00"]}
            confidence={0.97} source="Data Health agent" onApply={() => wait()} onDismiss={() => wait()}
          />
          <FixPreview
            title="Deposit doesn't match a transfer batch" rule="bank_transactions.unmatched_deposit"
            changes={[{ field: "match", label: "Matched batch", before: null, after: "Batch 2026-10-28 · $14,382.50" }]}
            why={["Same amount and settled one business day after the batch closed"]}
            confidence={0.74} source="rule" needsPerson="Moves money in the trust ledger · needs an accountant" onApply={() => wait()} onDismiss={() => wait()}
          />
        </div>

        <div className="flex flex-col gap-4 xl:col-span-5">
          <AISummaryCard
            title="Resident summary"
            bullets={["Jordan Lee, #412 at The Lofts at Riverside, 2 years 3 months", "Paid on time 23 of 26 months; currently 34 days late ($2,140.00)", "One open work order (AC not cooling), vendor scheduled Thursday", "Lease ends Feb 28; renewal likelihood 64%, down from 82% in July"]}
            generatedAt={ago(180)} source="precomputed" model="llama-3.3-70b" onRegenerate={() => wait(1200)}
            ask={{ entity: "residents", id: "res-p01-0001", title: "Jordan Lee" }}
          />
          <AISummaryCard title="Property summary" bullets={[]} loading />
          <RunTrace agent="Collections agent" status="waiting_approval" model="llama-3.3-70b" tokensIn={6120} tokensOut={1844} costCents={3} steps={STEPS} />
          <RunTrace agent="Maintenance Triage" status="running" live steps={STEPS.slice(0, 3)} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AgentCard name="Collections" icon={<Banknote />} goal="Follows up on late rent, drafts reminders, proposes late fees within state caps and offers payment plans." status="waiting_approval" lastRun={ago(6)} nextRun={ahead(54)} successRate={0.96} proposed={412} approved={371} autoApplied={208} autonomy="act_with_approval" model="llama-3.3-70b" onRunNow={() => wait(1500)} />
        <AgentCard name="Maintenance Triage" icon={<Wrench />} goal="Classifies new requests by trade and urgency, checks the owner limit and ranks vendors." status="running" lastRun={ago(1)} nextRun={null} successRate={0.92} proposed={1_128} approved={1_004} autoApplied={688} autonomy="auto_within_policy" onRunNow={() => wait(1500)} />
        <AgentCard name="Payables" icon={<ReceiptText />} goal="Reads invoices, codes them to GL, flags anomalies and vendor bank changes before payment." status="idle" lastRun={ago(38)} nextRun={ahead(22)} successRate={0.89} proposed={644} approved={590} autoApplied={0} autonomy="act_with_approval" onRunNow={() => wait(1500)} />
        <AgentCard name="Leasing" icon={<KeyRound />} goal="Answers leads, schedules tours, summarises screening and scores applicants with reasons." status="idle" lastRun={ago(14)} nextRun={ahead(46)} successRate={0.94} proposed={302} approved={281} autoApplied={119} autonomy="suggest" onRunNow={() => wait(1500)} />
        <AgentCard name="Data Health" icon={<HeartPulse />} goal="Runs data rules nightly, explains each issue and proposes fixes; money fixes go to a person." status="failed" lastRun={ago(300)} nextRun={ahead(600)} successRate={0.71} proposed={186} approved={142} autoApplied={61} autonomy="auto_within_policy" onRunNow={() => wait(1500)} />
        <AgentCard name="Compliance" icon={<ShieldCheck />} goal="Watches vendor COIs, inspections and permits; opens tasks 30 days before anything expires." status="idle" enabled={false} lastRun={ago(2_880)} successRate={0.98} proposed={58} approved={57} autoApplied={0} autonomy="suggest" />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground"><Bot className="size-3.5" /> Agent cards toggle, run, and show autonomy; runs open in the trace viewer.</p>
    </Section>
  );
}
