import Link from "next/link";
import { AlertTriangle, ArrowRight, FileText, Home, Mail, MessageSquare, Phone, ShieldCheck, Smartphone, Wrench } from "lucide-react";
import type { TabProps } from "@/extensions/tabs";
import { Money, RelativeDate, StatusBadge } from "@/components/app/display";
import { AIBadge } from "@/components/app/ai";
import { EmptyState } from "@/components/app/states";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MERGE_FIELDS, normalizeContact, suggestMerge, type Contact } from "../lib";
import { asOfDate, one, pageCtx, sql } from "../server";
import { ActionButton, IssueFix, MergeDialog } from "../ui/client";

// Resident 360: everything about one resident on one screen. Each card links to the full list
// behind it (ledger tab, conversations, requests, documents).

const FIELD_LABEL: Record<string, string> = { first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone", preferred_channel: "Preferred channel", language: "Language", autopay: "Autopay" };
const CHANNEL_ICON = { Email: Mail, SMS: Smartphone, Phone, Portal: MessageSquare } as const;

function Card({ title, href, hrefLabel, children, className, icon: Icon }: { title: string; href?: string; hrefLabel?: string; children: React.ReactNode; className?: string; icon?: typeof Home }) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold">{Icon && <Icon className="size-3.5 text-muted-foreground" />}{title}</h3>
        {href && <Link href={href} className="inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline">{hrefLabel ?? "Open"}<ArrowRight className="size-3" /></Link>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium tabular-nums">{children}</dd>
    </div>
  );
}

type Driver = { label: string; bad: boolean };

// Plain-language drivers behind the precomputed score, from the same ledger facts it uses.
function riskDrivers(f: { nsf_12m: number; late_months_12m: number; balance_cents: number; autopay: boolean; days_oldest: number | null }): Driver[] {
  return [
    { label: f.nsf_12m ? `${f.nsf_12m} returned payment${f.nsf_12m === 1 ? "" : "s"} (NSF) in 12 months` : "No returned payments in 12 months", bad: f.nsf_12m > 0 },
    { label: f.late_months_12m ? `Paid late in ${f.late_months_12m} of the last 12 months` : "Paid on time for 12 months", bad: f.late_months_12m >= 2 },
    { label: f.balance_cents > 0 ? `Owes ${(f.balance_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}${f.days_oldest ? `, oldest ${f.days_oldest} days` : ""}` : "No balance owed", bad: f.balance_cents > 0 },
    { label: f.autopay ? "On autopay" : "Not on autopay", bad: !f.autopay },
  ];
}

export async function Resident360({ id, actor }: TabProps) {
  const ctx = await pageCtx();
  const today = await asOfDate(ctx.db);
  const r = await one(ctx, "SELECT * FROM {residents} WHERE id = ?", [id]);
  if (!r) return <EmptyState title="Resident not found" />;
  const finance = ["principal", "regional_manager", "property_manager", "accountant"].includes(actor.role);

  const [members, lease, ledger, months, threads, requests, docs, issues] = await Promise.all([
    sql(ctx, "SELECT id, first_name || ' ' || last_name AS name, is_primary, status, phone FROM {residents} WHERE household_id = ? AND id <> ? ORDER BY is_primary DESC, last_name", [r.household_id, id]),
    one(ctx, `SELECT l.*, u.number AS unit, u.market_rent_cents, CAST(julianday(l.end_on) - julianday(?) AS INTEGER) AS days_to_end,
      (SELECT ri.status FROM {renters_insurance} ri WHERE ri.lease_id = l.id ORDER BY ri.expires_on DESC LIMIT 1) AS insurance_status,
      (SELECT ri.expires_on FROM {renters_insurance} ri WHERE ri.lease_id = l.id ORDER BY ri.expires_on DESC LIMIT 1) AS insurance_expires
      FROM {leases} l LEFT JOIN {units} u ON u.id = l.unit_id WHERE l.household_id = ? ORDER BY CASE WHEN l.status IN ('Active', 'Notice', 'Month-to-month', 'Eviction') THEN 0 ELSE 1 END, l.start_on DESC LIMIT 1`, [today, r.household_id]),
    one(ctx, `SELECT
      (SELECT coalesce(sum(amount_cents), 0) FROM {charges} WHERE household_id = ?1) - (SELECT coalesce(sum(amount_cents), 0) FROM {payments} WHERE lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1) AND nsf = 0)
        - (SELECT coalesce(sum(cr.amount_cents), 0) FROM {credits} cr WHERE cr.lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1)) AS balance_cents,
      (SELECT count(*) FROM {payments} WHERE lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1) AND nsf = 1 AND received_on >= date(?2, '-12 months')) AS nsf_12m,
      (SELECT count(DISTINCT substr(received_on, 1, 7)) FROM {payments} WHERE lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1) AND nsf = 0 AND CAST(substr(received_on, 9, 2) AS INTEGER) > 5 AND received_on >= date(?2, '-12 months')) AS late_months_12m,
      (SELECT max(received_on) FROM {payments} WHERE lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1) AND nsf = 0) AS last_paid_on,
      (SELECT amount_cents FROM {payments} WHERE lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1) AND nsf = 0 ORDER BY received_on DESC LIMIT 1) AS last_paid_cents,
      (SELECT method FROM {payments} WHERE lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1) AND nsf = 0 ORDER BY received_on DESC LIMIT 1) AS last_paid_method`, [r.household_id, today]),
    sql<{ period: string; charged: number; paid: number }>(ctx, `SELECT period, sum(charged) AS charged, sum(paid) AS paid FROM (
      SELECT period, amount_cents AS charged, 0 AS paid FROM {charges} WHERE household_id = ?1 AND period >= substr(date(?2, 'start of month', '-5 months'), 1, 7)
      UNION ALL SELECT substr(received_on, 1, 7), 0, amount_cents FROM {payments} WHERE lease_id IN (SELECT id FROM {leases} WHERE household_id = ?1) AND nsf = 0 AND received_on >= date(?2, 'start of month', '-5 months')
    ) GROUP BY period ORDER BY period`, [r.household_id, today]),
    sql(ctx, `SELECT t.id, t.subject, t.status, t.unread, t.last_message_at,
      (SELECT m.body FROM {messages} m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) AS last_body,
      (SELECT m.channel FROM {messages} m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) AS channel,
      (SELECT m.direction FROM {messages} m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) AS direction
      FROM {message_threads} t WHERE t.party_kind = 'resident' AND t.party_id = ? ORDER BY t.last_message_at DESC LIMIT 5`, [id]),
    sql(ctx, `SELECT 'service_requests' AS kind, s.id, substr(s.body, 1, 70) AS title, s.status, s.submitted_at AS at, s.urgency AS priority FROM {service_requests} s WHERE s.resident_id = ?1
      UNION ALL SELECT 'work_orders', w.id, w.title, w.status, w.opened_at, w.priority FROM {work_orders} w WHERE w.unit_id = (SELECT l.unit_id FROM {leases} l WHERE l.household_id = ?2 ORDER BY l.start_on DESC LIMIT 1) AND w.opened_at >= date(?3, '-180 days')
      ORDER BY at DESC LIMIT 6`, [id, r.household_id, today]),
    sql(ctx, `SELECT id, name, doc_type, uploaded_at, url FROM {documents} WHERE (entity_type = 'residents' AND entity_id = ?1) OR (entity_type = 'leases' AND entity_id IN (SELECT id FROM {leases} WHERE household_id = ?2)) ORDER BY uploaded_at DESC LIMIT 5`, [id, r.household_id]),
    sql(ctx, "SELECT i.*, coalesce(dr.name, i.rule_id) AS rule_name FROM {data_issues} i LEFT JOIN {data_rules} dr ON dr.id = i.rule_id WHERE i.status = 'open' AND ((i.entity_type = 'residents' AND i.entity_id = ?1) OR (i.rule_id = 'residents.possible_duplicate' AND i.evidence LIKE ?2))", [id, `%"${id}"%`]),
  ]);

  const balance = Math.max(Number(ledger?.balance_cents ?? 0), 0);
  const credit = Number(ledger?.balance_cents ?? 0) < 0 ? -Number(ledger?.balance_cents) : 0;
  const score = r.risk_score == null ? null : Number(r.risk_score);
  const band = score == null ? null : score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  const oldest = balance > 0 ? await one<{ d: number }>(ctx, `SELECT CAST(julianday(?) - julianday(min(c.due_on)) AS INTEGER) AS d FROM {charges} c WHERE c.household_id = ? AND c.due_on <= ? AND c.amount_cents > coalesce((SELECT sum(p.amount_cents) FROM {payments} p WHERE p.charge_id = c.id AND p.nsf = 0), 0)`, [today, r.household_id, today]) : null;
  const drivers = riskDrivers({ nsf_12m: Number(ledger?.nsf_12m ?? 0), late_months_12m: Number(ledger?.late_months_12m ?? 0), balance_cents: balance, autopay: !!r.autopay, days_oldest: oldest?.d ?? null });
  const contactFixes = normalizeContact(r as unknown as Contact);

  // Duplicate: the other record named in the issue's evidence.
  const dupIssue = issues.find((i) => i.rule_id === "residents.possible_duplicate");
  let merge: React.ReactNode = null;
  if (dupIssue) {
    const ids: string[] = (() => { try { const e = JSON.parse(String(dupIssue.evidence)); return e.ids ?? [dupIssue.entity_id, JSON.parse(String(dupIssue.suggested_fix ?? "{}")).merge_into].filter(Boolean); } catch { return []; } })();
    const other = ids.find((x) => x !== id);
    const o = other ? await one(ctx, "SELECT * FROM {residents} WHERE id = ?", [other]) : null;
    if (o) {
      // Keep the older record (lower seq in the base is older; ids sort the same way).
      const [keep, dup] = String(r.id) < String(o.id) ? [r, o] : [o, r];
      const s = suggestMerge(keep, dup);
      const side = (x: typeof r) => ({ id: String(x.id), label: `${x.first_name} ${x.last_name}`, values: Object.fromEntries(MERGE_FIELDS.map((f) => [f, f === "autopay" ? (x[f] ? "Yes" : "No") : String(x[f] ?? "")])) });
      merge = (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2.5">
          <AlertTriangle className="size-4 shrink-0 text-tone-warning" />
          <div className="min-w-0 flex-1 text-[13px]">
            <span className="font-medium">Possible duplicate:</span> <Link href={`/app/residents/${encodeURIComponent(String(o.id))}`} className="text-primary hover:underline">{String(o.first_name)} {String(o.last_name)}</Link>
            <span className="text-muted-foreground"> · same phone {String(o.phone)} · {Math.round(s.confidence * 100)}% likely the same person</span>
          </div>
          <MergeDialog keep={side(keep)} dup={side(dup)} fields={MERGE_FIELDS.map((f) => ({ key: f, label: FIELD_LABEL[f] }))} suggestion={s} issueId={String(dupIssue.id)} />
        </div>
      );
    }
  }
  const pieIssue = issues.find((i) => i.rule_id === "residents.phone_in_email");
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(Number(m.charged), Number(m.paid))));

  return (
    <div className="space-y-3" data-tour="resident-360">
      {merge}
      {contactFixes.length > 0 && (
        <IssueFix issueId={pieIssue ? String(pieIssue.id) : undefined} title={pieIssue ? "Phone number in the email field" : "Contact details need tidying"} rule={pieIssue ? "residents.phone_in_email" : undefined}
          changes={contactFixes.map((c) => ({ field: c.field, label: FIELD_LABEL[c.field], before: c.before, after: c.after }))} why={[...new Set(contactFixes.map((c) => c.why))]}
          confidence={0.97} source="rule" applyVia={{ entity: "residents", id, action: "residents.normalize_contact" }} />
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Delinquency risk" className={cn(band === "High" && "border-tone-danger/30")}>
          {score == null ? <p className="text-[12.5px] text-muted-foreground">No score yet. Scores need three months of payment history.</p> : (
            <>
              <div className="flex items-center gap-3">
                <div className={cn("text-[28px] font-semibold leading-none tabular-nums", band === "High" ? "text-tone-danger" : band === "Medium" ? "text-tone-warning" : "text-tone-success")}>{score}</div>
                <div className="text-[12px] leading-tight"><StatusBadge value={`${band} risk`} tone={band === "High" ? "danger" : band === "Medium" ? "warning" : "success"} /><div className="mt-1 text-muted-foreground">0–100, higher is riskier</div></div>
                <AIBadge source="precomputed" model="risk model" className="ml-auto" />
              </div>
              <ul className="mt-3 space-y-1 text-[12.5px]">
                {drivers.map((d) => <li key={d.label} className="flex items-start gap-1.5"><span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", d.bad ? "bg-tone-danger" : "bg-tone-success")} />{d.label}</li>)}
              </ul>
              <p className="mt-2 text-[11.5px] text-muted-foreground">Scored nightly from payment history. A person decides any action.</p>
            </>
          )}
        </Card>

        <Card title="Ledger" href={finance ? `?tab=ledger` : undefined} hrefLabel="Open ledger">
          {!finance ? <p className="text-[12.5px] text-muted-foreground">Balances are visible to property managers and accounting.</p> : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Fact label={credit ? "Credit on account" : "Balance owed"}><span className={cn(balance > 0 && "text-tone-danger")}><Money value={credit || balance} cents style="full" tone="none" /></span></Fact>
                <Fact label="Last payment">{ledger?.last_paid_on ? <><Money value={Number(ledger.last_paid_cents)} cents style="whole" /> · {formatDate(String(ledger.last_paid_on))}</> : "—"}</Fact>
              </div>
              <div className="mt-3" aria-label="Charged and paid, last 6 months">
                <div className="flex h-16 items-end gap-2">
                  {months.map((m) => (
                    <div key={m.period} className="flex flex-1 flex-col items-center gap-1" title={`${m.period}: charged $${(Number(m.charged) / 100).toFixed(2)}, paid $${(Number(m.paid) / 100).toFixed(2)}`}>
                      <div className="flex h-12 w-full items-end justify-center gap-0.5">
                        <span className="w-1/3 rounded-sm bg-muted-foreground/30" style={{ height: `${(Number(m.charged) / maxMonth) * 100}%` }} />
                        <span className="w-1/3 rounded-sm bg-primary" style={{ height: `${(Number(m.paid) / maxMonth) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{new Date(`${m.period}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-muted-foreground/30" />Charged</span><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-primary" />Paid</span>{ledger?.last_paid_method ? <span className="ml-auto">{String(ledger.last_paid_method)}{r.autopay ? " · autopay" : ""}</span> : null}</div>
              </div>
            </>
          )}
        </Card>

        <Card title="Lease" icon={Home} href={lease ? `/app/leases/${encodeURIComponent(String(lease.id))}` : undefined} hrefLabel="Open lease">
          {!lease ? <p className="text-[12.5px] text-muted-foreground">No lease on file for this household.</p> : (
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Unit">#{String(lease.unit)} <StatusBadge value={lease.status} className="ml-1" /></Fact>
              <Fact label="Rent"><Money value={Number(lease.rent_cents)} cents style="whole" />{lease.market_rent_cents ? <span className="ml-1 text-[11px] font-normal text-muted-foreground">mkt <Money value={Number(lease.market_rent_cents)} cents style="whole" /></span> : null}</Fact>
              <Fact label="Term">{formatDate(String(lease.start_on), "always")} – {lease.end_on ? formatDate(String(lease.end_on), "always") : "open"}</Fact>
              <Fact label="Ends in">{lease.days_to_end == null ? "—" : Number(lease.days_to_end) < 0 ? `${-Number(lease.days_to_end)} days ago` : `${lease.days_to_end} days`}</Fact>
              <Fact label="Renters insurance">{lease.insurance_status ? <StatusBadge value={lease.insurance_status} /> : <span className="text-tone-warning">None on file</span>}</Fact>
              <Fact label="Deposit"><Money value={Number(lease.deposit_cents)} cents style="whole" /></Fact>
            </dl>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Contact and household" className="lg:col-span-1">
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Phone">{String(r.phone || "—")}</Fact>
            <Fact label="Email"><span className="font-normal">{String(r.email || "—")}</span></Fact>
            <Fact label="Prefers">{String(r.preferred_channel)} · {r.language === "es" ? "Spanish" : "English"}</Fact>
            <Fact label="Role">{r.is_primary ? "Primary on lease" : "Occupant"}</Fact>
          </dl>
          <div className="mt-3 border-t pt-2">
            <div className="text-[11px] text-muted-foreground">Household · {members.length + 1} {members.length ? "people" : "person"}</div>
            <ul className="mt-1 space-y-1">
              {members.length === 0 && <li className="text-[12.5px] text-muted-foreground">Lives alone</li>}
              {members.map((m) => <li key={String(m.id)} className="flex items-center justify-between text-[12.5px]"><Link href={`/app/residents/${encodeURIComponent(String(m.id))}`} className="hover:text-primary hover:underline">{String(m.name)}</Link><span className="text-muted-foreground">{m.is_primary ? "Primary" : "Occupant"}</span></li>)}
            </ul>
          </div>
        </Card>

        <Card title="Communications" icon={MessageSquare} href={`?tab=threads`} hrefLabel="All messages" className="lg:col-span-2">
          {threads.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No conversations yet. Messages by email, SMS, portal and phone show here.</p> : (
            <ol className="relative space-y-2.5 before:absolute before:inset-y-1 before:left-[7px] before:w-px before:bg-border">
              {threads.map((t) => {
                const Icon = CHANNEL_ICON[String(t.channel) as keyof typeof CHANNEL_ICON] ?? MessageSquare;
                return (
                  <li key={String(t.id)} className="relative flex gap-3 pl-0">
                    <span className="relative z-10 mt-0.5 grid size-[15px] shrink-0 place-items-center rounded-full border bg-card"><Icon className="size-2.5 text-muted-foreground" /></span>
                    <Link href={`/app/communications/inbox?t=${encodeURIComponent(String(t.id))}`} className="min-w-0 flex-1 rounded-md px-1 -mx-1 hover:bg-muted/50">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className={cn("truncate", t.unread ? "font-semibold" : "font-medium")}>{String(t.subject)}</span>
                        <StatusBadge value={t.status} className="shrink-0" />
                        <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground"><RelativeDate value={String(t.last_message_at)} /></span>
                      </div>
                      <p className="truncate text-[12.5px] text-muted-foreground">{t.direction === "out" ? "You: " : ""}{String(t.last_body ?? "")}</p>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Requests and work orders" icon={Wrench} href={`?tab=requests`} hrefLabel="All requests">
          {requests.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No requests or work orders in the last 6 months.</p> : (
            <ul className="divide-y">
              {requests.map((q) => (
                <li key={String(q.id)} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                  <Link href={q.kind === "work_orders" ? `/app/maintenance/work-orders/${q.id}` : `/app/maintenance/requests/${q.id}`} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">
                    <span className="text-muted-foreground">{q.kind === "work_orders" ? String(q.id) : "Request"} · </span>{String(q.title)}
                  </Link>
                  {q.priority && q.priority !== "Normal" ? <StatusBadge value={q.priority} /> : null}
                  <StatusBadge value={q.status} />
                  <span className="w-16 shrink-0 text-right text-muted-foreground">{formatDate(String(q.at))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Documents" icon={FileText} href="?tab=documents" hrefLabel="All documents">
          {docs.length === 0 ? <p className="text-[12.5px] text-muted-foreground">No documents filed to this resident or their leases.</p> : (
            <ul className="divide-y">
              {docs.map((d) => (
                <li key={String(d.id)} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <Link href={/^\/(?!\/)/.test(String(d.url)) ? String(d.url) : `/app/documents/${d.id}`} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{String(d.name)}</Link>
                  <span className="text-muted-foreground">{String(d.doc_type ?? "")}</span>
                  <span className="w-16 shrink-0 text-right text-muted-foreground">{formatDate(String(d.uploaded_at))}</span>
                </li>
              ))}
            </ul>
          )}
          {lease && (
            <div className="mt-2 flex items-center gap-2 border-t pt-2 text-[12px] text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              {lease.insurance_status ? <>Renters insurance {String(lease.insurance_status).toLowerCase()}{lease.insurance_expires ? `, expires ${formatDate(String(lease.insurance_expires), "always")}` : ""}</> : "No renters insurance on file"}
            </div>
          )}
        </Card>
      </div>
      {threads.some((t) => t.unread && t.status !== "Closed") && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <ActionButton entity="message_threads" id={String(threads.find((t) => t.unread && t.status !== "Closed")!.id)} action="message_threads.suggest_reply" label="Draft a reply to the latest message" icon="ai" />
          <span>Drafts only; you review and send from the inbox.</span>
        </div>
      )}
    </div>
  );
}
