"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { money } from "./mockAi";
import { DEMO_TODAY, seed } from "./seed";
import type { DemoState, ExtractedInvoice, LineItem, ValidationResult, WorkOrder } from "./types";

// Bump when the seed changes so saved demos from older versions are replaced.
const KEY = "propniti-demo-v2";

const stamp = () => `${DEMO_TODAY} ${new Date().toTimeString().slice(0, 5)}`;
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

type Actions = {
  nudge: (userId: string, message: string, actor: string) => void;
  payInvoice: (invoiceId: string) => void;
  setValidation: (woId: string, v: ValidationResult) => void;
  approveWorkOrder: (woId: string) => void;
  requestChanges: (woId: string) => void;
  submitInvoice: (woId: string, items: LineItem[], photos: string[], invoiceNumber?: string) => void;
  attachDocument: (woId: string, inv: ExtractedInvoice) => void;
  updateJob: (woId: string, status: WorkOrder["status"], photo?: string) => void;
  reportIssue: (tenantId: string, text: string) => void;
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

  const update = useCallback((fn: (s: DemoState) => DemoState) => {
    setState((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

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
      payInvoice: (invoiceId) =>
        update((s) => {
          const inv = s.invoices.find((i) => i.id === invoiceId)!;
          const t = s.tenancies.find((x) => x.id === inv.tenancyId)!;
          const tenant = s.users.find((u) => u.id === t.tenantId)!;
          const paid: DemoState = {
            ...s,
            invoices: s.invoices.map((i) => (i.id === invoiceId ? { ...i, status: "Paid" } : i)),
            payments: [
              { id: uid("pay"), kind: "Rent", payee: tenant.name, amount: inv.amount, date: DEMO_TODAY, status: "Received", ref: inv.id },
              ...s.payments,
            ],
          };
          return log(notify(paid, "u-pm", `${tenant.name} paid ${money(inv.amount)} (${inv.id}).`), tenant.name, "Rent paid", `${inv.id} ${money(inv.amount)} by ACH`);
        }),
      setValidation: (woId, v) =>
        update((s) =>
          log(setWo(s, woId, { validation: v }), "Agent", "Invoice validated", `${woId}: ${v.decision}, confidence ${Math.round(v.confidence * 100)}% (${v.source})`),
        ),
      approveWorkOrder: (woId) =>
        update((s) => {
          const wo = s.workOrders.find((w) => w.id === woId)!;
          const vendor = vendorOf(s, wo);
          const amount = wo.submission?.total ?? wo.po.total;
          let next = setWo(s, woId, { status: "Paid" });
          next = {
            ...next,
            vendors: next.vendors.map((v) => (v.id === vendor?.id ? { ...v, ytdPaid: v.ytdPaid + amount } : v)),
            payments: [
              { id: uid("pay"), kind: "Vendor payout", payee: vendor?.company ?? "Vendor", amount, date: DEMO_TODAY, status: "Sent", ref: woId },
              ...next.payments,
            ],
          };
          if (vendor) next = notify(next, vendor.userId, `${woId} approved. ${money(amount)} sent by ACH, arriving in 1–2 business days.`);
          return log(next, "Maya Patel", "Payment approved", `${woId}: ${money(amount)} to ${vendor?.company} by ACH`);
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
