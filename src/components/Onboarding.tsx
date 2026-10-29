"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FIELD_LABELS, IMPORT_FIELDS, REQUIRED, applyMapping, existingUnitKeys, parseCsv, parseMoney, validateRows, widthProblems, type ImportRow, type Mapping } from "@/lib/importer";
import { MANAGEMENT_FEE_RATE } from "@/lib/ledger";
import { money } from "@/lib/mockAi";
import { useDemo } from "@/lib/store";
import type { AiSource } from "@/lib/types";
import { Wordmark } from "./Logo";
import { Badge, Button, Card, SourceNote, Table } from "./ui";

const STEPS = ["Portfolio", "Review", "Get paid", "Invite", "Done"] as const;
const BANKS = ["Chase", "Bank of America", "Wells Fargo", "Citi", "U.S. Bank", "Capital One"];
const field = "w-full rounded-xl border-0 bg-white/70 px-3 py-2 text-sm ring-1 ring-inset ring-[#1C1917]/12 focus:outline-none focus:ring-2 focus:ring-[#1C1917]";

type Draft = { table?: string[][]; rows?: ImportRow[]; mapping?: Mapping; source: string; ai?: { source: AiSource; note?: string } };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

export function Onboarding() {
  const { state, act, busy: saving } = useDemo();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [imported, setImported] = useState<{ rows: number; skipped: number } | null>(null);

  // A CSV/TSV file or sample: parse it, then ask the AI which column is which.
  async function loadTable(text: string, source: string) {
    setError(null);
    let table: string[][];
    try {
      table = parseCsv(text);
    } catch (e) {
      return setError((e as Error).message);
    }
    if (table.length < 2) return setError("That file has no data rows. Export your rent roll as CSV and try again.");
    const width = widthProblems(table);
    if (width.length) return setError(`${width.slice(0, 3).join("; ")}. Check the export and try again.`);
    setBusy("Matching your columns…");
    try {
      const res = await postJson<{ mapping: Mapping; source: AiSource; note?: string }>("/api/ai/import-map", { headers: table[0].slice(0, 60), samples: table.slice(1, 6).map((r) => r.slice(0, 60)) });
      setDraft({ table, mapping: res.mapping, source, ai: { source: res.source, note: res.note } });
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File) {
    if (file.size > 2 * 1024 * 1024) return setError("File too large (max 2 MB). Export only the rent roll.");
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) return setError("Upload a .csv or .tsv export. From Excel or Google Sheets: File → Download → CSV.");
    await loadTable(await file.text(), file.name);
  }

  async function onPaste() {
    setError(null);
    setBusy("Reading what you pasted…");
    try {
      const res = await postJson<{ rows: ImportRow[]; source: AiSource; note?: string }>("/api/ai/import-parse", { text: paste });
      if (!res.rows.length) setError(res.note ?? "Couldn't find any tenancies in that text.");
      else {
        setDraft({ rows: res.rows, source: "pasted text", ai: { source: res.source, note: res.note } });
        setStep(1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadSample(file: string) {
    const res = await fetch(`/samples/${file}`);
    await loadTable(await res.text(), file);
  }

  const rows = useMemo(() => (draft?.table && draft.mapping ? applyMapping(draft.table, draft.mapping) : draft?.rows ?? []), [draft]);
  const existing = useMemo(() => existingUnitKeys(state), [state]);
  const checks = useMemo(() => validateRows(rows, existing), [rows, existing]);
  const valid = checks.filter((c) => !c.errors.length);
  const missingRequired = draft?.mapping ? REQUIRED.filter((f) => !draft.mapping![f]) : [];
  const owners = state.users.filter((u) => u.role === "Owner");

  return (
    <main className="min-h-[100dvh] bg-[#F6F2EA] px-4 pb-24 pt-8 text-[#1C1917]">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Propniti home"><Wordmark size={32} text="text-3xl" /></Link>
          <Link href="/pm" className="text-[13px] text-[#57534E] underline underline-offset-4">Skip setup</Link>
        </div>

        <ol className="mt-10 flex flex-wrap gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium ${i === step ? "bg-[#1C1917] text-[#FBF9F4]" : i < step ? "bg-[#5F7A4E]/12 text-[#4A6340]" : "bg-[#1C1917]/[0.04] text-[#78716C]"}`} aria-current={i === step ? "step" : undefined}>
              {i < step ? "✓ " : `${i + 1}. `}{s}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="mt-10">
            <h1 className="font-serif text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95]">Bring your portfolio <em className="text-[#8A6A45]">in minutes.</em></h1>
            <p className="mt-4 max-w-2xl text-lg text-[#57534E]">Upload the rent roll you already export from AppFolio, Buildium, Yardi, Rent Manager or a spreadsheet. AI matches your columns and checks every row before anything is imported.</p>
            <div className="mt-10 grid gap-5 lg:grid-cols-2">
              <Card title="Import a file">
                <p className="text-sm text-[#57534E]">CSV or TSV, up to 2 MB. One row per tenancy.</p>
                <label
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) onFile(f);
                  }}
                  className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-[#1C1917]/20 bg-[#F6F2EA] px-6 py-10 text-center transition-colors hover:bg-[#F6F2EA]/60 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                  <span className="font-serif text-2xl">Choose a file</span>
                  <span className="mt-1 text-xs text-[#78716C]">or drop it here</span>
                  <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                </label>
                <p className="mt-4 text-xs text-[#78716C]">
                  No file handy? Try a sample:{" "}
                  <button className="underline underline-offset-4" onClick={() => loadSample("appfolio-style-rent-roll.csv")}>AppFolio-style rent roll</button> ·{" "}
                  <button className="underline underline-offset-4" onClick={() => loadSample("buildium-style-export.csv")}>Buildium-style export (with errors)</button>
                </p>
              </Card>
              <Card title="Paste anything">
                <p className="text-sm text-[#57534E]">A table copied from a spreadsheet, an email from the previous manager, or your own notes. AI turns it into rows.</p>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={7}
                  maxLength={20000}
                  className={`mt-4 ${field}`}
                  placeholder={"e.g.\nWillow Flats, 12 Willow St, Austin\n  Unit 1 — Ana Gomez, $1,650/mo, lease to Aug 31 2027\n  Unit 2 — Ben Carter, $1,700/mo, month-to-month"}
                />
                <Button className="mt-3" onClick={onPaste} disabled={!paste.trim() || !!busy}>Read with AI</Button>
              </Card>
            </div>
            {busy && <p className="mt-6 text-sm text-[#57534E]" role="status">{busy}</p>}
            {error && <p className="mt-6 text-sm text-[#8E4327]" role="alert">{error}</p>}
          </section>
        )}

        {step === 1 && draft && (
          <section className="mt-10 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-serif text-5xl leading-none">Check it <em className="text-[#8A6A45]">over.</em></h1>
                <p className="mt-3 text-[#57534E]">From {draft.source}: {rows.length} row{rows.length === 1 ? "" : "s"} found.</p>
              </div>
              {draft.ai && <SourceNote source={draft.ai.source} note={draft.ai.note} />}
            </div>

            {draft.table && draft.mapping && (
              <Card title="Columns">
                <p className="mb-4 text-sm text-[#57534E]">Matched {draft.ai?.source === "mock" ? "by column name" : "by AI"}. Change any that look wrong.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {IMPORT_FIELDS.map((f) => (
                    <label key={f} className="block text-xs text-[#57534E]">
                      {FIELD_LABELS[f]}{REQUIRED.includes(f) && <span className="text-[#8E4327]"> *</span>}
                      <select
                        value={draft.mapping![f] ?? ""}
                        onChange={(e) => setDraft({ ...draft, mapping: { ...draft.mapping, [f]: e.target.value || null } })}
                        className={`mt-1 ${field} ${REQUIRED.includes(f) && !draft.mapping![f] ? "ring-[#A4502F]/50" : ""}`}
                      >
                        <option value="">Not in file</option>
                        {draft.table![0].map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                {missingRequired.length > 0 && <p className="mt-3 text-sm text-[#8E4327]">Pick a column for: {missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}.</p>}
              </Card>
            )}

            <Card title="Rows" action={<span className="flex gap-2"><Badge tone="green">{valid.length} ready</Badge>{checks.length - valid.length > 0 && <Badge tone="red">{checks.length - valid.length} need fixing</Badge>}</span>}>
              <Table
                head={["Property", "Unit", "Tenant", "Rent", "Lease end", "Check"]}
                rows={checks.map((c) => [
                  c.row.property ?? "—",
                  c.row.unit ?? "—",
                  c.row.tenant ?? "—",
                  <span key="r" className="whitespace-nowrap tabular-nums">{Number.isFinite(parseMoney(c.row.rent)) ? money(parseMoney(c.row.rent)) : c.row.rent ?? "—"}</span>,
                  <span key="e" className="whitespace-nowrap tabular-nums">{c.row.leaseEnd ?? "—"}</span>,
                  <div key="c" className="text-xs">
                    {c.errors.map((e) => <div key={e} className="text-[#8E4327]">✗ {e}</div>)}
                    {c.warnings.map((w) => <div key={w} className="text-[#8A6420]">! {w}</div>)}
                    {!c.errors.length && !c.warnings.length && <span className="text-[#4A6340]">✓ Ready</span>}
                  </div>,
                ])}
              />
              {checks.length - valid.length > 0 && <p className="mt-4 text-sm text-[#57534E]">Rows with ✗ are skipped. Fix them in your file and import again, or carry on with the rest.</p>}
            </Card>

            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
              <Button
                disabled={saving || !valid.length || missingRequired.length > 0}
                onClick={() => {
                  act.importRows(valid.map((c) => c.row), draft.source);
                  setImported({ rows: valid.length, skipped: checks.length - valid.length });
                  setStep(2);
                }}
              >
                Import {valid.length} tenanc{valid.length === 1 ? "y" : "ies"}
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="mt-10 space-y-6">
            <h1 className="font-serif text-5xl leading-none">Get <em className="text-[#8A6A45]">paid.</em></h1>
            {imported && <p className="text-[#57534E]">Imported {imported.rows} tenancies{imported.skipped ? `; ${imported.skipped} skipped` : ""}.</p>}
            <Card title="Connect your trust account">
              <p className="text-sm text-[#57534E]">Rent lands here; Propniti takes the {Math.round(MANAGEMENT_FEE_RATE * 100)}% management fee and pays vendors and owners from it. In production you link it securely through Plaid; here it&apos;s simulated.</p>
              {state.setup?.bank ? (
                <p className="mt-4 text-sm"><Badge tone="green">Connected</Badge> {state.setup.bank} trust account ending 4821</p>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {BANKS.map((b) => (
                    <button key={b} disabled={saving} onClick={() => act.connectBank(b)} className="rounded-2xl bg-[#F6F2EA] px-4 py-3 text-left text-sm ring-1 ring-[#1C1917]/[0.08] transition-colors hover:bg-white">
                      {b}
                    </button>
                  ))}
                </div>
              )}
            </Card>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(imported ? 1 : 0)}>Back</Button>
              <Button onClick={() => setStep(3)}>{state.setup?.bank ? "Continue" : "Skip for now"}</Button>
            </div>
          </section>
        )}

        {step === 3 && <InviteStep owners={owners} onBack={() => setStep(2)} onNext={() => setStep(4)} />}

        {step === 4 && (
          <section className="mt-10 space-y-6">
            <h1 className="font-serif text-5xl leading-none">You&apos;re <em className="text-[#8A6A45]">set.</em></h1>
            <Card title="What happens next">
              <ul className="space-y-2 text-sm text-[#44403C]">
                <li>✓ {state.properties.length} properties and {state.tenancies.length} tenancies in your portfolio</li>
                <li>{state.setup?.bank ? "✓" : "○"} Trust account {state.setup?.bank ? `at ${state.setup.bank} connected` : "not connected yet"}</li>
                <li>{state.setup?.invited.length ? "✓" : "○"} {state.setup?.invited.length ?? 0} people invited</li>
                <li>→ Use the dashboard to send reminders and validate invoices. (In production the agent also sweeps every 15 minutes; that schedule isn&apos;t running in this demo.)</li>
              </ul>
            </Card>
            <Button
              onClick={() => {
                act.finishOnboarding();
                router.push("/pm");
              }}
            >
              Go to my dashboard
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}

function InviteStep({ owners, onBack, onNext }: { owners: { id: string; name: string; email: string }[]; onBack: () => void; onNext: () => void }) {
  const { act, busy } = useDemo();
  const [emails, setEmails] = useState<Record<string, string>>(Object.fromEntries(owners.map((o) => [o.id, o.email])));
  const [vendors, setVendors] = useState("");
  const [sent, setSent] = useState(0);
  const list = [...Object.values(emails), ...vendors.split(/[\s,;]+/)].map((e) => e.trim()).filter(Boolean);
  const bad = list.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return (
    <section className="mt-10 space-y-6">
      <h1 className="font-serif text-5xl leading-none">Invite your <em className="text-[#8A6A45]">people.</em></h1>
      <Card title="Owners">
        <p className="mb-4 text-sm text-[#57534E]">Owners see their own properties, statements and payouts.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {owners.map((o) => (
            <label key={o.id} className="block text-xs text-[#57534E]">
              {o.name}
              <input type="email" value={emails[o.id] ?? ""} onChange={(e) => setEmails({ ...emails, [o.id]: e.target.value })} placeholder="owner@example.com" className={`mt-1 ${field}`} />
            </label>
          ))}
        </div>
      </Card>
      <Card title="Vendors">
        <p className="mb-3 text-sm text-[#57534E]">Emails separated by commas or new lines. Vendors get work orders, submit invoices and get paid here.</p>
        <textarea value={vendors} onChange={(e) => setVendors(e.target.value)} rows={3} className={field} placeholder="billing@coolairhvac.example, rosa@quickfixplumbing.example" />
      </Card>
      {bad.length > 0 && <p className="text-sm text-[#8E4327]" role="alert">Check these addresses: {bad.join(", ")}</p>}
      {sent > 0 && <p className="text-sm text-[#4A6340]" role="status">{sent} invite{sent > 1 ? "s" : ""} sent (simulated).</p>}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button
          disabled={busy || !list.length || bad.length > 0}
          onClick={() => {
            act.invite(list);
            setSent(list.length);
          }}
        >
          Send {list.length || ""} invite{list.length === 1 ? "" : "s"}
        </Button>
        <Button variant="secondary" onClick={onNext}>{sent ? "Continue" : "Skip for now"}</Button>
      </div>
    </section>
  );
}
