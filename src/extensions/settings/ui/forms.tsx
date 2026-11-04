"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiJson } from "@/components/app/forms/api";
import { ConfirmDialog } from "@/components/app/forms/ConfirmDialog";
import { useSetupProgress } from "@/components/app/onboarding/SetupChecklist";
import { cn } from "@/lib/utils";

// Client forms for the settings pages. Every save goes to a guarded POST/PATCH and refreshes
// the server-rendered page, so what you see is what was stored.

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const save = async (method: "POST" | "PATCH", url: string, body: unknown, done?: (r: Record<string, unknown>) => void) => {
    setBusy(true);
    try {
      const r = await apiJson<Record<string, unknown>>(method, url, body);
      toast.success(typeof r.message === "string" ? r.message : "Saved");
      done?.(r);
      router.refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <Field orientation="responsive" className="sm:grid sm:grid-cols-[200px_1fr] sm:items-start sm:gap-6">
      <FieldContent>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {hint && <FieldDescription>{hint}</FieldDescription>}
      </FieldContent>
      <div className="max-w-md">{children}</div>
    </Field>
  );
}

function Pick({ id, value, options, onChange, disabled }: { id?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------------------------

export type CompanyProfile = { legal_name: string; ein: string; address: string; phone: string; support_email: string; timezone: string; fiscal_year_start: string; license_number: string };
const TZ: Record<string, string> = { "America/Chicago": "Central (Chicago)", "America/New_York": "Eastern (New York)", "America/Phoenix": "Arizona (Phoenix, no daylight saving)", "America/Denver": "Mountain (Denver)", "America/Los_Angeles": "Pacific (Los Angeles)" };

export function CompanyForm({ initial, canEdit }: { initial: CompanyProfile; canEdit: boolean }) {
  const [v, setV] = useState(initial);
  const { busy, save } = useSave();
  const setup = useSetupProgress();
  const set = (k: keyof CompanyProfile) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const field = (k: keyof CompanyProfile, label: string, hint?: string, type = "text", autoComplete = "off") => (
    <Row label={label} hint={hint} htmlFor={`co-${k}`}>
      <Input id={`co-${k}`} name={k} type={type} autoComplete={autoComplete} value={v[k]} onChange={set(k)} disabled={!canEdit} />
    </Row>
  );
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void save("POST", "/app/settings/company/save", v, () => setup.setDone("company", true)); }}>
      {field("legal_name", "Legal name", "As it appears on owner statements and 1099s.", "text", "organization")}
      {field("ein", "EIN", "Federal employer identification number, 12-3456789.")}
      {field("license_number", "Broker license", "State real estate license for the managing brokerage.")}
      {field("address", "Business address", undefined, "text", "street-address")}
      {field("phone", "Main phone", undefined, "tel", "tel")}
      {field("support_email", "Resident support email", "Replies to resident and owner email go here.", "email", "email")}
      <Row label="Time zone" hint="Due dates, SLAs and agent schedules use it." htmlFor="co-tz">
        <Pick id="co-tz" value={v.timezone} onChange={(x) => setV((p) => ({ ...p, timezone: x }))} options={Object.entries(TZ).map(([value, label]) => ({ value, label }))} disabled={!canEdit} />
      </Row>
      <Row label="Fiscal year starts" htmlFor="co-fy">
        <Pick id="co-fy" value={v.fiscal_year_start} onChange={(x) => setV((p) => ({ ...p, fiscal_year_start: x }))} options={["January", "April", "July", "October"].map((m) => ({ value: m, label: m }))} disabled={!canEdit} />
      </Row>
      {canEdit && (
        <div className="flex items-center gap-2 border-t pt-4 sm:pl-[224px]">
          <Button type="submit" size="sm" disabled={busy || !dirty}>{busy && <Loader2 data-icon="inline-start" className="animate-spin" />}Save changes</Button>
          {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setV(initial)}>Discard</Button>}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------------------------

export function IntegrationToggle({ k, name, connected, canEdit }: { k: string; name: string; connected: boolean; canEdit: boolean }) {
  const { busy, save } = useSave();
  const setup = useSetupProgress();
  const [confirm, setConfirm] = useState(false);
  if (!canEdit) return null;
  const run = () => save("POST", "/app/settings/integrations/connect", { key: k, connect: !connected }, () => { if (k === "plaid") setup.setDone("bank", !connected); });
  return (
    <>
      <Button size="sm" variant={connected ? "outline" : "default"} disabled={busy} aria-label={`${connected ? "Disconnect" : "Connect"} ${name}`} onClick={() => (connected ? setConfirm(true) : void run())}>
        {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}{connected ? "Disconnect" : "Connect"}
      </Button>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Disconnect ${name}?`} confirmLabel="Disconnect"
        description="Data stops flowing until someone reconnects it. Anything already imported stays." onConfirm={run} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------------------------

type Channels = Record<string, boolean>;
export function NotificationMatrix({ types, channels, initial, digest }: { types: { key: string; label: string; description: string }[]; channels: { key: string; label: string }[]; initial: Record<string, Channels>; digest: string }) {
  const [state, setState] = useState(initial);
  const [dig, setDig] = useState(digest);
  const router = useRouter();
  const post = async (body: unknown, undo: () => void) => {
    try {
      await apiJson("POST", "/app/settings/notifications/prefs", body);
      router.refresh();
    } catch (e) {
      undo();
      toast.error((e as Error).message);
    }
  };
  const toggle = (t: string, c: string, on: boolean) => {
    const row = { ...state[t], [c]: on };
    setState((cur) => ({ ...cur, [t]: { ...cur[t], [c]: on } }));
    void post({ types: { [t]: row } }, () => setState((cur) => ({ ...cur, [t]: { ...cur[t], [c]: !on } })));
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Notify me about</th>{channels.map((c) => <th key={c.key} className="w-20 px-3 py-2 text-center font-medium">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.key} className="border-t">
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  <div className="font-medium">{t.label}</div>
                  <div className="text-[12px] text-muted-foreground">{t.description}</div>
                </th>
                {channels.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-center">
                    <Switch checked={!!state[t.key]?.[c.key]} onCheckedChange={(on) => toggle(t.key, c.key, on)} aria-label={`${t.label} by ${c.label}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Row label="Email digest" hint="One email with what needs you, instead of one per event." htmlFor="digest">
        <Pick id="digest" value={dig} onChange={(x) => { const prev = dig; setDig(x); void post({ digest: x }, () => setDig(prev)); }} options={["Off", "Daily 7:00", "Daily 17:00", "Weekly Monday"].map((d) => ({ value: d, label: d }))} />
      </Row>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Invite a user (opens on ?new=1, the admin's quick action)
// ---------------------------------------------------------------------------------------------

export function InviteUser({ roles, regions, properties }: { roles: { value: string; label: string }[]; regions: { value: string; label: string }[]; properties: { value: string; label: string }[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [v, setV] = useState({ name: "", email: "", title: "", role: "property_manager", scope_kind: "property", scope_ids: [] as string[] });
  const { busy, save } = useSave();
  const setup = useSetupProgress();
  const options = v.scope_kind === "region" ? regions : properties;
  const close = (o: boolean) => {
    setOpen(o);
    if (!o && params.get("new")) router.replace("/app/settings/users");
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save("POST", "/app/settings/users/invite", v, () => setup.setDone("team", true));
    if (ok) { close(false); setV((p) => ({ ...p, name: "", email: "", title: "", scope_ids: [] })); }
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus data-icon="inline-start" />Invite user</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Invite a user</DialogTitle>
              <DialogDescription>They get an email to set a password. Their role decides what they can do; the scope decides which properties.</DialogDescription>
            </DialogHeader>
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="inv-name">Full name</FieldLabel><Input id="inv-name" name="name" autoComplete="off" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
              <Field><FieldLabel htmlFor="inv-email">Work email</FieldLabel><Input id="inv-email" name="email" type="email" autoComplete="off" spellCheck={false} required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
              <Field><FieldLabel htmlFor="inv-title">Title</FieldLabel><Input id="inv-title" name="title" autoComplete="off" required placeholder="Assistant property manager…" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
              <Field><FieldLabel htmlFor="inv-role">Role</FieldLabel><Pick id="inv-role" value={v.role} onChange={(x) => setV({ ...v, role: x })} options={roles} /></Field>
              <Field className="sm:col-span-2"><FieldLabel htmlFor="inv-scope">Scope</FieldLabel>
                <Pick id="inv-scope" value={v.scope_kind} onChange={(x) => setV({ ...v, scope_kind: x, scope_ids: [] })} options={[{ value: "org", label: "Whole org" }, { value: "region", label: "Regions" }, { value: "property", label: "Properties" }]} />
              </Field>
            </FieldGroup>
            {v.scope_kind !== "org" && (
              <FieldSet className="max-h-44 overflow-y-auto rounded-md border p-2">
                <FieldLegend className="sr-only">{v.scope_kind === "region" ? "Regions" : "Properties"}</FieldLegend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {options.map((o) => {
                    const on = v.scope_ids.includes(o.value);
                    return (
                      <Field key={o.value} orientation="horizontal" className={cn("rounded px-2 py-1 hover:bg-muted", on && "bg-primary/5")}>
                        <Checkbox id={`inv-scope-${o.value}`} checked={on} onCheckedChange={() => setV({ ...v, scope_ids: on ? v.scope_ids.filter((x) => x !== o.value) : [...v.scope_ids, o.value] })} />
                        <FieldLabel htmlFor={`inv-scope-${o.value}`} className="truncate text-[12.5px] font-normal">{o.label}</FieldLabel>
                      </Field>
                    );
                  })}
                </div>
              </FieldSet>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 data-icon="inline-start" className="animate-spin" />}Send invite</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Approval policy edit (generic PATCH; the change history is the audit trail it writes)
// ---------------------------------------------------------------------------------------------

export type PolicyRow = { id: string; name: string; category: string; limit: number | null; approver_role: string; owner_approval_over: number | null; always_human: boolean };

const dollars = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,]/g, "")));

export function EditPolicy({ p, roles }: { p: PolicyRow; roles: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const fromPolicy = () => ({ limit: p.limit == null ? "" : String(p.limit), owner: p.owner_approval_over == null ? "" : String(p.owner_approval_over), approver: p.approver_role, human: p.always_human });
  const [v, setV] = useState(fromPolicy);
  const { busy, save } = useSave();
  const bad = [v.limit, v.owner].some((x) => x.trim() !== "" && !Number.isFinite(dollars(x)));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save("PATCH", `/api/e/approval_policies/${encodeURIComponent(p.id)}`, { limit: v.human ? null : dollars(v.limit), owner_approval_over: dollars(v.owner), approver_role: v.approver, always_human: v.human });
    if (ok) setOpen(false);
  };
  return (
    <>
      <Button size="icon-sm" variant="ghost" onClick={() => { setV(fromPolicy()); setOpen(true); }} aria-label={`Edit ${p.name}`}><Pencil /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{p.name}</DialogTitle>
              <DialogDescription>Agents and staff act alone up to the limit. Above it the approver decides; above the owner threshold the owner also approves in their portal.</DialogDescription>
            </DialogHeader>
            <Field orientation="horizontal" className="rounded-md border px-3 py-2">
              <FieldContent>
                <FieldLabel htmlFor="pol-human">Always a person</FieldLabel>
                <FieldDescription>Never automated, whatever the amount. Use for legal and safety.</FieldDescription>
              </FieldContent>
              <Switch id="pol-human" checked={v.human} onCheckedChange={(x) => setV({ ...v, human: x })} />
            </Field>
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="pol-limit">Auto-approve up to ($)</FieldLabel><Input id="pol-limit" aria-invalid={bad || undefined} name="limit" inputMode="decimal" autoComplete="off" disabled={v.human} placeholder="Blank: always a person…" value={v.human ? "" : v.limit} onChange={(e) => setV({ ...v, limit: e.target.value })} /></Field>
              <Field><FieldLabel htmlFor="pol-owner">Owner approves above ($)</FieldLabel><Input id="pol-owner" aria-invalid={bad || undefined} name="owner" inputMode="decimal" autoComplete="off" placeholder="Blank: never…" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })} /></Field>
              <Field className="sm:col-span-2"><FieldLabel htmlFor="pol-role">Approver above the limit</FieldLabel><Pick id="pol-role" value={v.approver} onChange={(x) => setV({ ...v, approver: x })} options={roles} /></Field>
            </FieldGroup>
            {bad && <FieldError>Enter amounts in dollars, for example 1500.</FieldError>}
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={busy || bad}>{busy && <Loader2 data-icon="inline-start" className="animate-spin" />}Save policy</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Amend a state rule (named action state_rules.amend: adds a dated version)
// ---------------------------------------------------------------------------------------------

export function AmendRule({ id, title, value, unit, note, minDate }: { id: string; title: string; value: string; unit: string; note: string; minDate: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ value, note, effective_from: "" });
  const openFresh = () => { setV({ value, note, effective_from: "" }); setOpen(true); };
  const { busy, save } = useSave();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await save("POST", `/api/e/state_rules/${encodeURIComponent(id)}/actions/amend`, v)) setOpen(false);
  };
  return (
    <>
      <Button size="xs" variant="ghost" onClick={openFresh}>Amend</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Amend {title}</DialogTitle>
              <DialogDescription>Adds a new version from the date you choose. The current version stays in the history and still applies to charges before that date.</DialogDescription>
            </DialogHeader>
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="sr-value">Value ({unit})</FieldLabel><Input id="sr-value" name="value" inputMode="decimal" autoComplete="off" required value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></Field>
              <Field><FieldLabel htmlFor="sr-from">Effective from</FieldLabel><Input id="sr-from" name="effective_from" type="date" required min={minDate} value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} /></Field>
              <Field className="sm:col-span-2"><FieldLabel htmlFor="sr-note">Summary and citation</FieldLabel><Textarea id="sr-note" name="note" rows={4} required value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 data-icon="inline-start" className="animate-spin" />}Add version</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Automation on/off (generic PATCH of `enabled`)
// ---------------------------------------------------------------------------------------------

export function AutomationSwitch({ id, name, enabled, canEdit }: { id: string; name: string; enabled: boolean; canEdit: boolean }) {
  const [on, setOn] = useState(enabled);
  const router = useRouter();
  const flip = async (next: boolean) => {
    setOn(next);
    try {
      await apiJson("PATCH", `/api/e/automation_rules/${encodeURIComponent(id)}`, { enabled: next });
      toast.success(`${name} turned ${next ? "on" : "off"}`);
      router.refresh();
    } catch (e) {
      setOn(!next);
      toast.error((e as Error).message);
    }
  };
  return <Switch checked={on} disabled={!canEdit} onCheckedChange={flip} aria-label={`${name}: ${on ? "on" : "off"}`} />;
}
