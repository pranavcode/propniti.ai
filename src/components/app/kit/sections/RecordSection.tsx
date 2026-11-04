"use client";
import { demoNow } from "@/lib/clock";

import { useState } from "react";
import { Archive, Copy, FileDown, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Money } from "../../display";
import { ConfirmDialog, EntityFormSheet, type FieldSpec } from "../../forms";
import { ActivityTimeline, RecordPage, type ActivityEvent, type DocumentRow, type NoteRow, type TaskRow } from "../../record";
import { Section } from "../../page";

// Kit: RecordPage with realistic sample data for The Lofts at Riverside (p01), plus the form
// sheet, confirm dialog and a standalone activity timeline.

const day = (d: number, h = 15) => { const x = demoNow(); x.setUTCDate(x.getUTCDate() - d); x.setUTCHours(h, 12, 0, 0); return x.toISOString(); };
const ymd = (d: number) => { const x = demoNow(); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

const PEOPLE = [
  { id: "marcus", name: "Marcus Bell", title: "Property manager" },
  { id: "lena", name: "Lena Ortiz", title: "Leasing agent" },
  { id: "tom", name: "Tom Alvarez", title: "Maintenance supervisor" },
  { id: "grace", name: "Grace Kim", title: "Senior accountant" },
  { id: "priya", name: "Priya Shah", title: "Regional manager" },
];

const FIELDS: FieldSpec[] = [
  { key: "name", label: "Name", type: "text", required: true, editable: true },
  { key: "status", label: "Status", type: "enum", editable: true, enum: [{ value: "Active", tone: "success" }, { value: "Lease-up", tone: "info" }, { value: "Renovation", tone: "warning" }, { value: "Disposed", tone: "neutral" }] },
  { key: "manager_id", label: "Manager", type: "ref", editable: true, options: PEOPLE.slice(0, 3).map((p) => ({ value: p.id, label: p.name })) },
  { key: "unit_count", label: "Units", type: "number", editable: false },
  { key: "market_rent", label: "Avg market rent", type: "money", editable: true, help: "Used for loss-to-lease and renewal pricing." },
  { key: "acquired_on", label: "Acquired", type: "date", editable: true },
  { key: "pet_friendly", label: "Pet friendly", type: "bool", editable: true },
  { key: "notes", label: "Access notes", type: "text", editable: true },
];
const VALUES = { name: "The Lofts at Riverside", status: "Active", manager_id: "marcus", unit_count: 186, market_rent: 1845, acquired_on: "2021-06-15", pet_friendly: true, notes: "Gate code rotates monthly; leasing office has the fob log." };

const ACTIVITY: ActivityEvent[] = [
  { id: "a1", at: day(0, 9), actor_kind: "staff", actor_id: "marcus", actor_name: "Marcus Bell", verb: "updated", summary: "updated the property", data: { before: { market_rent: 1810 }, after: { market_rent: 1845 } } },
  { id: "a2", at: day(0, 7), actor_kind: "agent", actor_id: "collections", actor_name: "Collections Agent", verb: "proposed", summary: "proposed 6 late-rent reminders", data: { model: "llama-3.3-70b" } },
  { id: "a3", at: day(0, 6), actor_kind: "agent", actor_id: "data_health", actor_name: "Data Health Agent", verb: "detected", summary: "flagged a ZIP code missing on the property address" },
  { id: "a4", at: day(0, 6), actor_kind: "agent", actor_id: "maintenance_triage", actor_name: "Maintenance Triage", verb: "assigned", summary: "routed WO-2291 (water heater) to Lone Star Plumbing" },
  { id: "a5", at: day(0, 5), actor_kind: "system", actor_id: "late_fees", actor_name: "Late-fee rule", verb: "posted", summary: "posted 4 late fees under the Texas cap" },
  { id: "a6", at: day(1, 15), actor_kind: "resident", actor_id: "res-p01-0001", actor_name: "Jordan Lee", verb: "paid", summary: "paid November rent", data: { before: { status: "Open" }, after: { status: "Paid", amount: 1795 } } },
  { id: "a7", at: day(3, 11), actor_kind: "staff", actor_id: "grace", actor_name: "Grace Kim", verb: "approved", summary: "approved bill BL-1182 from ABC HVAC" },
  { id: "a8", at: day(19, 16), actor_kind: "staff", actor_id: "lena", actor_name: "Lena Ortiz", verb: "status_changed", summary: "moved Unit 412 to rent ready", data: { before: { status: "Make ready" }, after: { status: "Rent ready" } } },
];

const NOTES: NoteRow[] = [
  { id: "n1", body: "Owner asked for the roof bid comparison before the Q1 capex call. @[Grace Kim](staff:grace) can you pull the last two invoices?", author_id: "marcus", author_name: "Marcus Bell", created_at: day(0, 8), pinned: true },
  { id: "n2", body: "Pool resurfacing scheduled for the week of the 18th; residents notified through the portal.", author_id: "tom", author_name: "Tom Alvarez", created_at: day(2, 14) },
];

const TASKS: TaskRow[] = [
  { id: "t1", title: "Review 6 late-rent reminders proposed by the Collections Agent", status: "Open", priority: "High", due_on: ymd(0), assignee_id: "marcus", source: "Agent", created_at: day(0) },
  { id: "t2", title: "Walk Unit 304 before move-in", status: "Open", priority: "Normal", due_on: ymd(2), assignee_id: "lena", created_at: day(1) },
  { id: "t3", title: "Renew boiler inspection certificate", status: "Open", priority: "Normal", due_on: ymd(-3), assignee_id: "tom", created_at: day(9) },
  { id: "t4", title: "Send October owner statement", status: "Done", priority: "Normal", due_on: ymd(-4), assignee_id: "grace", created_at: day(12) },
];

const DOCS: DocumentRow[] = [
  { id: "d1", name: "CoolAir HVAC invoice INV-4471.png", url: "/samples/coolair-invoice.png", mime: "image/png", doc_type: "Invoice", classify_confidence: 0.97, filed_to: "Bills › CoolAir HVAC", classified_by: "document_classifier", uploaded_at: day(6) },
  { id: "d2", name: "Roof inspection photos.jpg", url: "/img/props/p01-court.webp", mime: "image/webp", doc_type: "Inspection report", uploaded_at: day(14) },
  { id: "d3", name: "Rent roll October.csv", url: "/samples/appfolio-style-rent-roll.csv", mime: "text/csv", doc_type: "Rent roll", classify_confidence: 0.88, filed_to: "The Lofts at Riverside › Reports", classified_by: "document_classifier", uploaded_at: day(30) },
];

const wait = <T,>(v: T, ms = 500) => new Promise<T>((r) => setTimeout(() => r(v), ms));

function OverviewPanel() {
  const stats = [["Occupancy", "95.2%", "177 of 186 units"], ["Delinquency", "$14,820", "11 residents · 3 over 60 days"], ["NOI MTD", "$128,400", "+4.1% vs budget"], ["Open work orders", "23", "4 past SLA"]] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {stats.map(([label, value, sub]) => (
        <div key={label} className="rounded-lg border bg-card p-3">
          <div className="text-[12px] text-muted-foreground">{label}</div>
          <div className="mt-1 text-[20px] font-semibold tracking-tight tabular-nums">{value}</div>
          <div className="text-[12px] text-muted-foreground">{sub}</div>
        </div>
      ))}
    </div>
  );
}

export function RecordSection() {
  const [sheet, setSheet] = useState<"create" | "edit" | null>(null);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-8">
      <Section id="record" title="RecordPage" description="Header with photo, status, data health, facts and actions; prev/next with [ and ]; URL tabs; automatic Activity, Notes (with @mentions), Tasks and Documents tabs; rail with inline-edit details and related records.">
        <div className="overflow-hidden rounded-xl border bg-background">
          <RecordPage
            entity="properties"
            id="p01"
            label={{ one: "property", many: "properties" }}
            listHref="/app/properties"
            title="The Lofts at Riverside"
            subtitle="Mid-rise multifamily · East Riverside, Austin TX 78741 · Class A · Built 2019"
            image="/img/props/p01-400.webp"
            status={{ value: "Active", tone: "success" }}
            health={[{ id: "i1", rule: "properties.missing_zip_state", severity: "warn", summary: "ZIP code missing on the mailing address" }]}
            onFix={() => toast("Opens the fix preview")}
            facts={[
              { label: "Units", value: "186" },
              { label: "Occupancy", value: "95.2%" },
              { label: "Avg rent", value: <Money value={1845} style="whole" /> },
              { label: "Delinquent", value: <Money value={14820} style="whole" tone="none" /> },
              { label: "Owner", value: "Bluebonnet Residential Fund II", href: "/app/owners/ow01" },
              { label: "Manager", value: "Marcus Bell" },
            ]}
            actions={<><Button variant="outline" size="sm" onClick={() => setSheet("edit")}><Pencil /> Edit</Button><Button size="sm" onClick={() => setSheet("create")}><Plus /> New work order</Button></>}
            secondaryActions={[
              { key: "email", label: "Email owner", icon: <Mail /> },
              { key: "export", label: "Export rent roll", icon: <FileDown /> },
              { key: "copy", label: "Copy link", icon: <Copy />, onSelect: () => toast.success("Link copied") },
              { key: "archive", label: "Archive", icon: <Archive /> },
              { key: "delete", label: "Delete property", icon: <Trash2 />, tone: "danger", onSelect: () => setConfirm(true) },
            ]}
            nav={{ index: 1, total: 30, nextHref: "/app/properties/p02" }}
            tabs={[{ key: "overview", label: "Overview" }, { key: "units", label: "Units", count: 186 }, { key: "ledger", label: "Ledger" }]}
            panels={{ overview: <OverviewPanel /> }}
            capabilities={{ activity: true, notes: true, tasks: true, documents: true }}
            people={PEOPLE}
            fields={FIELDS}
            values={VALUES}
            onSaveField={(_k, v) => wait(v)}
            related={[
              { key: "owner", label: "Owner", total: 1, rows: [{ id: "ow01", title: "Bluebonnet Residential Fund II", subtitle: "Helen Carter · 4 properties", href: "/app/owners/ow01" }] },
              { key: "leases", label: "Expiring leases", total: 14, href: "/app/leases?f.property_id=p01", rows: [
                { id: "l1", title: "Unit 412 · Jordan Lee", subtitle: "Ends Dec 31", status: "Notice", meta: <Money value={1795} style="whole" /> },
                { id: "l2", title: "Unit 207 · Maya Patel", subtitle: "Ends Jan 15", status: "Active", meta: <Money value={1640} style="whole" /> },
                { id: "l3", title: "Unit 118 · Diego Hernández", subtitle: "Ends Jan 31", status: "Active", meta: <Money value={2150} style="whole" /> },
              ] },
              { key: "wo", label: "Open work orders", total: 23, href: "/app/maintenance/work-orders?f.property_id=p01", rows: [
                { id: "w1", title: "WO-2291 · Water heater leak", subtitle: "Unit 304 · Lone Star Plumbing", status: "Past SLA", statusTone: "danger" },
                { id: "w2", title: "WO-2288 · AC not cooling", subtitle: "Unit 512 · Unassigned", status: "New" },
              ] },
            ]}
            initial={{ activity: ACTIVITY, notes: NOTES, tasks: TASKS, documents: DOCS }}
          />
        </div>
      </Section>

      <Section id="timeline" title="ActivityTimeline" description="Day buckets, field-level diffs, agent events marked ✦ and folded into “N automation events”.">
        <div className="max-w-2xl rounded-lg border bg-card p-4"><ActivityTimeline events={ACTIVITY} /></div>
      </Section>

      <Section id="forms" title="Forms" description="Create and edit in a sheet generated from field specs (react-hook-form + zod), optimistic save with View and Undo toasts; delete confirmation with type-to-confirm.">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setSheet("create")}><Plus /> New property (sheet)</Button>
          <Button size="sm" variant="outline" onClick={() => setSheet("edit")}><Pencil /> Edit property</Button>
          <Button size="sm" variant="destructive" onClick={() => setConfirm(true)}><Trash2 /> Delete…</Button>
        </div>
      </Section>

      <EntityFormSheet
        open={sheet !== null}
        onOpenChange={(o) => !o && setSheet(null)}
        mode={sheet ?? "create"}
        entity="properties"
        label={{ one: "Property", many: "Properties" }}
        fields={FIELDS}
        initial={sheet === "edit" ? VALUES : undefined}
        route="/app/properties"
        onSubmit={() => wait({ id: "p31" }, 700)}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete The Lofts at Riverside?"
        description="186 units, 14 open leases and 23 work orders reference this property. They stay in the audit log; the property leaves every list."
        confirmLabel="Delete property"
        typeToConfirm="The Lofts at Riverside"
        onConfirm={() => wait(null, 600).then(() => toast.success("Deleted (demo)"))}
      />
    </div>
  );
}
