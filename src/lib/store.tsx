"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { TRUST, addTransfer, approveWorkOrder, disburse, settle } from "./ledger";
import { money } from "./mockAi";
import { importPortfolio, type ImportRow } from "./importer";
import { submissionKey } from "./names";
import { upsertRating } from "./ratings";
import { DEMO_TODAY, seed } from "./seed";
import type { DemoState, ExtractedInvoice, LineItem, RatingSubject, ValidationResult, WorkOrder } from "./types";

// Bump when the seed changes so saved demos from older versions are replaced.
const KEY = "propniti-demo-v4";

const stamp = () => `${DEMO_TODAY} ${new Date().toTimeString().slice(0, 5)}`;
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

type Actions = {
  nudge: (userId: string, message: string, actor: string) => void;
  payInvoice: (invoiceId: string) => void;
  setValidation: (woId: string, v: ValidationResult, forSubmission: string) => void;
  approveWorkOrder: (woId: string) => void;
  requestChanges: (woId: string) => void;
  submitInvoice: (woId: string, items: LineItem[], photos: string[], invoiceNumber?: string) => void;
  attachDocument: (woId: string, inv: ExtractedInvoice) => void;
  updateJob: (woId: string, status: WorkOrder["status"], photo?: string) => void;
  reportIssue: (tenantId: string, text: string) => void;
  disburseOwner: (ownerId: string) => void;
  rate: (by: string, subject: RatingSubject, stars: number, comment: string, ref?: string) => void;
  importRows: (rows: ImportRow[], source: string) => void;
  connectBank: (bank: string) => void;
  invite: (emails: string[]) => void;
  finishOnboarding: () => void;
  reset: () => void;
};

const Ctx = createContext<{ state: DemoState; act: Actions } | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(seed);

  // Each viewer keeps their own copy of the demo in this browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Load after hydration so server and client render the same seed first.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setState(JSON.parse(saved));
    } catch {}
  }, []);

  // Persist only real changes, so an idle tab never writes its stale copy over another tab's work.
  // Each change applies to the newest saved copy (another tab may have saved since) and bumps rev.
  const update = useCallback((fn: (s: DemoState) => DemoState) => {
    setState((prev) => {
      let base = prev;
      try {
        const raw = localStorage.getItem(KEY);
        const stored = raw ? (JSON.parse(raw) as DemoState) : null;
        if (stored && (stored.rev ?? 0) > (prev.rev ?? 0)) base = stored;
      } catch {}
      const changed = fn(base);
      if (changed === base) return base;
      const next = { ...changed, rev: (base.rev ?? 0) + 1 };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // Pick up changes made in other tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        setState(JSON.parse(e.newValue));
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Settle due ACH transfers once a second (the demo's stand-in for the bank).
  useEffect(() => {
    const timer = setInterval(() => {
      update((s) => {
        if (!s.transfers.some((t) => t.status === "Pending" && (t.settlesAt ?? 0) <= Date.now())) return s;
        const { state, cleared } = settle(s, Date.now(), stamp(), () => uid("tr"));
        // Tell the receiving side the money has landed.
        return cleared.reduce((acc, t) => {
          const msg = (userId: string, message: string): DemoState => ({
            ...acc,
            notifications: [{ id: uid("n"), userId, channel: acc.users.find((u) => u.id === userId)?.channel ?? "Email", message, ts: stamp() }, ...acc.notifications],
          });
          if (t.kind === "Rent") return msg(t.from.id, `Payment received: ${money(t.amount)} for ${t.ref}. Thank you!`);
          if (t.kind === "Vendor payout") return msg(acc.vendors.find((v) => v.id === t.to.id)?.userId ?? "", `${money(t.amount)} for ${t.ref} has arrived in your account.`);
          if (t.kind === "Owner payout") return msg(t.to.id, `Your payout of ${money(t.amount)} has arrived.`);
          return acc;
        }, state);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [update]);

  const act = useMemo<Actions>(() => {
    const log = (s: DemoState, actor: string, action: string, detail: string): DemoState => ({
      ...s,
      audit: [{ id: uid("a"), ts: stamp(), actor, action, detail }, ...s.audit],
    });
    const notify = (s: DemoState, userId: string, message: string): DemoState => {
      const user = s.users.find((u) => u.id === userId);
      return {
        ...s,
        notifications: [{ id: uid("n"), userId, channel: user?.channel ?? "Email", message, ts: stamp() }, ...s.notifications],
      };
    };
    const setWo = (s: DemoState, woId: string, patch: Partial<WorkOrder>): DemoState => ({
      ...s,
      workOrders: s.workOrders.map((w) => (w.id === woId ? { ...w, ...patch } : w)),
    });
    const vendorOf = (s: DemoState, wo: WorkOrder) => s.vendors.find((v) => v.id === wo.vendorId);

    return {
      nudge: (userId, message, actor) =>
        update((s) => {
          const user = s.users.find((u) => u.id === userId);
          return log(notify(s, userId, message), actor, "Nudge sent", `To ${user?.name} by ${user?.channel}: "${message}"`);
        }),
      // Rent goes into the trust account as a pending ACH transfer; it clears (and the fee is taken) in settle().
      payInvoice: (invoiceId) =>
        update((s) => {
          const inv = s.invoices.find((i) => i.id === invoiceId)!;
          const t = s.tenancies.find((x) => x.id === inv.tenancyId)!;
          const tenant = s.users.find((u) => u.id === t.tenantId)!;
          const before = s.transfers.length;
          let next = addTransfer(
            s,
            { key: `rent:${inv.id}`, kind: "Rent", from: { kind: "tenant", id: tenant.id, name: tenant.name }, to: TRUST, amount: inv.amount, propertyId: t.propertyId, ref: inv.id, created: stamp() },
            Date.now(),
            uid("tr"),
          );
          if (next.transfers.length === before) return s; // already paid or in flight
          next = { ...next, invoices: next.invoices.map((i) => (i.id === invoiceId ? { ...i, status: "Processing" } : i)) };
          next = notify(next, "u-pm", `${tenant.name} paid ${money(inv.amount)} (${inv.id}); ACH pending.`);
          return log(next, tenant.name, "Rent payment started", `${inv.id} ${money(inv.amount)} by ACH into the trust account`);
        }),
      // A result is kept only if the invoice hasn't changed since it was sent for validation.
      setValidation: (woId, v, forSubmission) =>
        update((s) => {
          const wo = s.workOrders.find((w) => w.id === woId);
          if (!wo || submissionKey(wo) !== forSubmission) return s;
          return log(setWo(s, woId, { validation: v }), "Agent", "Invoice validated", `${woId}: ${v.decision}, confidence ${Math.round(v.confidence * 100)}% (${v.source})`);
        }),
      // Approval rules (status, funds, idempotency) live in ledger.approveWorkOrder.
      approveWorkOrder: (woId) =>
        update((s) => {
          const { state, error, amount } = approveWorkOrder(s, woId, Date.now(), stamp(), uid("tr"));
          if (error) return state === s && s.audit[0]?.detail.endsWith(error) ? s : log(s, "Maya Patel", "Approval refused", `${woId}: ${error}`);
          const wo = state.workOrders.find((w) => w.id === woId)!;
          const vendor = vendorOf(state, wo);
          let next = state;
          if (vendor) next = notify(next, vendor.userId, `${woId} approved. ${money(amount)} sent by ACH, arriving in 1–2 business days.`);
          return log(next, "Maya Patel", vendor ? "Payment approved" : "Job completed", vendor ? `${woId}: ${money(amount)} to ${vendor.company} by ACH` : `${woId} completed in-house`);
        }),
      requestChanges: (woId) =>
        update((s) => {
          const wo = s.workOrders.find((w) => w.id === woId)!;
          const vendor = vendorOf(s, wo);
          const issues = wo.validation?.issues.join("; ") || "please check the invoice against the PO";
          let next = setWo(s, woId, { status: "Changes requested" });
          if (vendor) next = notify(next, vendor.userId, `${woId} needs changes before payment: ${issues}. Please resubmit.`);
          return log(next, "Maya Patel", "Changes requested", `${woId} sent back to ${vendor?.company}`);
        }),
      submitInvoice: (woId, items, photos, invoiceNumber) =>
        update((s) => {
          const total = items.reduce((a, i) => a + i.amount, 0);
          const wo = s.workOrders.find((w) => w.id === woId)!;
          const next = setWo(s, woId, {
            status: "Submitted",
            validation: undefined,
            submission: { invoiceNumber: invoiceNumber || `INV-${Math.floor(Math.random() * 9000) + 1000}`, items, total, photos },
          });
          return log(notify(next, "u-pm", `${vendorOf(s, wo)?.company} submitted an invoice for ${woId}: ${money(total)}.`), vendorOf(s, wo)?.company ?? "Vendor", "Invoice submitted", `${woId}: ${money(total)}, ${photos.length} photo(s)`);
        }),
      // A paper/PDF invoice read by AI replaces the submitted figures; validation must run again.
      attachDocument: (woId, inv) =>
        update((s) => {
          const wo = s.workOrders.find((w) => w.id === woId)!;
          const next = setWo(s, woId, {
            status: "Submitted",
            validation: undefined,
            submission: { invoiceNumber: inv.invoiceNumber || "scanned", items: inv.lineItems, total: inv.total, photos: wo.submission?.photos ?? [] },
          });
          return log(next, "Agent", "Invoice document read", `${woId}: ${inv.vendor || "vendor"} invoice ${inv.invoiceNumber || ""}, total ${money(inv.total)}`);
        }),
      updateJob: (woId, status, photo) =>
        update((s) => {
          const wo = s.workOrders.find((w) => w.id === woId)!;
          const photos = photo ? [...(wo.submission?.photos ?? []), photo] : wo.submission?.photos ?? [];
          const next = setWo(s, woId, {
            status,
            submission: photo || wo.submission ? { invoiceNumber: "in-house", items: wo.po.items, total: wo.po.total, photos } : undefined,
          });
          return log(next, "Luis Romero", "Job updated", `${woId}: ${status}${photo ? ` with photo "${photo}"` : ""}`);
        }),
      reportIssue: (tenantId, text) =>
        update((s) => {
          const t = s.tenancies.find((x) => x.tenantId === tenantId)!;
          const id = `WO-${1050 + s.workOrders.length}`;
          const wo: WorkOrder = {
            id, propertyId: t.propertyId, unit: t.unit, title: text, vendorId: "in-house", assigneeId: "u-m1", estimatedHours: 1, status: "Assigned",
            po: { number: "PO-pending", items: [{ description: "Diagnosis", amount: 0 }], total: 0, photosRequired: 1 },
          };
          const tenant = s.users.find((u) => u.id === tenantId)!;
          let next: DemoState = { ...s, workOrders: [wo, ...s.workOrders] };
          next = notify(next, "u-m1", `New job ${id} at ${t.unit}: ${text}`);
          next = notify(next, tenantId, `Thanks — ${id} is logged and assigned to Luis from maintenance.`);
          return log(next, tenant.name, "Issue reported", `${id}: ${text}`);
        }),
      disburseOwner: (ownerId) =>
        update((s) => {
          const { state, amount } = disburse(s, ownerId, Date.now(), stamp(), uid("payout"));
          if (!amount) return s;
          const owner = s.users.find((u) => u.id === ownerId)!;
          return log(notify(state, ownerId, `Your payout of ${money(amount)} is on its way by ACH.`), "Maya Patel", "Owner payout", `${money(amount)} to ${owner.name} from the trust account`);
        }),
      rate: (by, subject, stars, comment, ref) =>
        update((s) => {
          const rater = s.users.find((u) => u.id === by);
          const next = { ...s, ratings: upsertRating(s.ratings, { id: uid("r"), by, subject, stars, comment: comment.trim(), ref, ts: stamp() }) };
          return log(next, rater?.name ?? "User", "Rating", `${stars}★ for ${subject.kind} ${subject.id}${ref ? ` (${ref})` : ""}`);
        }),
      importRows: (rows, source) =>
        update((s) => {
          const { state, counts } = importPortfolio(s, rows);
          const setup = { invited: [], completed: false, ...s.setup, importedRows: (s.setup?.importedRows ?? 0) + counts.tenancies };
          return log({ ...state, setup }, "Maya Patel", "Portfolio imported", `${counts.tenancies} tenancies, ${counts.properties} new properties from ${source}`);
        }),
      connectBank: (bank) =>
        update((s) => log({ ...s, setup: { invited: [], importedRows: 0, completed: false, ...s.setup, bank } }, "Maya Patel", "Bank connected", `${bank} trust account linked (simulated Plaid)`)),
      invite: (emails) =>
        update((s) => {
          const setup = { importedRows: 0, completed: false, ...s.setup, invited: [...(s.setup?.invited ?? []), ...emails] };
          return log({ ...s, setup }, "Maya Patel", "Invites sent", `${emails.length} invite(s): ${emails.join(", ")}`);
        }),
      finishOnboarding: () => update((s) => ({ ...s, setup: { invited: [], importedRows: 0, ...s.setup, completed: true } })),
      reset: () => update(() => seed()),
    };
  }, [update]);

  return <Ctx.Provider value={{ state, act }}>{children}</Ctx.Provider>;
}

export function useDemo() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDemo must be used inside DemoProvider");
  return ctx;
}
