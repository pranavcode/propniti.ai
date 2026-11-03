"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Landmark, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const post = async (vendor: string, action: string, body: unknown) => {
  const res = await fetch(`/api/e/vendors/${encodeURIComponent(vendor)}/actions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(out.error ?? "Nothing was changed. Try again.");
  return out as { message?: string };
};

// Accountant-only: enter a new bank account (holds payments) or verify a pending change by callback.
export function BankForms({ vendor, company, held, canChange, canVerify, changedByMe }: { vendor: string; company: string; held: boolean; canChange: boolean; canVerify: boolean; changedByMe: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"change" | "verify" | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ bank_last4: "", received_via: "Email", requested_by: "", note: "", spoke_with: "", phone_on_file: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = mode === "change"
        ? await post(vendor, "vendors.change_bank_account", { bank_last4: f.bank_last4, received_via: f.received_via, requested_by: f.requested_by, ...(f.note ? { note: f.note } : {}) })
        : await post(vendor, "vendors.confirm_bank_change", { spoke_with: f.spoke_with, phone_on_file: true });
      toast.success(r.message ?? "Saved");
      setMode(null);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canChange && <Button size="sm" variant="outline" onClick={() => setMode(mode === "change" ? null : "change")}><Landmark />Change bank account</Button>}
        {held && canVerify && <Button size="sm" onClick={() => setMode(mode === "verify" ? null : "verify")} disabled={changedByMe} title={changedByMe ? "You entered this change; someone else has to verify it" : undefined}><ShieldCheck />Verify by callback</Button>}
      </div>
      {mode && (
        <form onSubmit={submit} className="grid max-w-xl gap-3 rounded-lg border bg-muted/30 p-3">
          {mode === "change" ? (
            <>
              <p className="text-[12.5px] text-muted-foreground">Payments to {company} stop until a different person calls the vendor on the phone number already on file and confirms the new account.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1"><Label htmlFor="bank_last4">New account, last 4 digits</Label><Input id="bank_last4" inputMode="numeric" maxLength={4} pattern="\d{4}" required value={f.bank_last4} onChange={set("bank_last4")} autoComplete="off" /></div>
                <div className="grid gap-1"><Label htmlFor="received_via">Request received by</Label>
                  <select id="received_via" className="h-8 rounded-md border bg-background px-2 text-[13px]" value={f.received_via} onChange={set("received_via")}>
                    {["Email", "Vendor portal", "Letter", "Phone call"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid gap-1"><Label htmlFor="requested_by">Requested by</Label><Input id="requested_by" required minLength={2} value={f.requested_by} onChange={set("requested_by")} placeholder="Name and role at the vendor…" /></div>
              <div className="grid gap-1"><Label htmlFor="note">Note (optional)</Label><Textarea id="note" rows={2} value={f.note} onChange={set("note")} /></div>
            </>
          ) : (
            <>
              <p className="text-[12.5px] text-muted-foreground">Call {company} on the number already on file, not one from the change request, and confirm the new account ending.</p>
              <div className="grid gap-1"><Label htmlFor="spoke_with">Spoke with</Label><Input id="spoke_with" required minLength={2} value={f.spoke_with} onChange={set("spoke_with")} placeholder="Name of the person you reached…" /></div>
              <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={f.phone_on_file} onCheckedChange={(v) => setF({ ...f, phone_on_file: v === true })} />I called the phone number already on file</label>
            </>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || (mode === "verify" && !f.phone_on_file)}>{busy ? "Saving…" : mode === "change" ? "Record change and hold payments" : "Verify and release payments"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
