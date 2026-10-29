"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ImportRow } from "./importer";
import { seed } from "./seed";
import type { DemoState, ExtractedInvoice, LineItem, RatingSubject, ValidationResult, WorkOrder } from "./types";

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

// busy is true while a change is being saved; action buttons stay disabled until it lands.
const Ctx = createContext<{ state: DemoState; act: Actions; busy: boolean } | null>(null);

const POLL_MS = 2_000;
const wo = (id: string, action: string) => `/api/work-orders/${encodeURIComponent(id)}/${action}`;

// The demo lives on the server, one private copy per visitor; every response carries the
// whole state, so the browser just shows what it gets back.
export function DemoProvider({ children }: { children: React.ReactNode }) {
  // Seed data renders until the first response arrives.
  const [state, setState] = useState<DemoState>(seed);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Counts writes started, so a read that began before a write can't overwrite its result.
  const writes = useRef(0);
  const pendingWrites = useRef(0);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    try {
      const res = await fetch(path, { cache: "no-store", ...init });
      const data = (await res.json().catch(() => ({}))) as { state?: DemoState; error?: string };
      if (!res.ok) setError(data.error ?? `Something went wrong (error ${res.status}). Try again.`);
      return data.state;
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }, []);

  const refresh = useCallback(async () => {
    const startedAt = writes.current;
    const next = await request("/api/state");
    if (next && startedAt === writes.current && pendingWrites.current === 0) setState(next);
  }, [request]);

  const post = useCallback(
    async (path: string, body: unknown = {}, headers: Record<string, string> = {}) => {
      writes.current++;
      pendingWrites.current++;
      setInFlight((n) => n + 1);
      try {
        const next = await request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
        if (next) setState(next);
      } finally {
        pendingWrites.current--;
        setInFlight((n) => n - 1);
      }
    },
    [request],
  );

  // Load after hydration so server and client render the same seed first.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set when the fetch resolves
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  // While money is in flight, check back until the bank transfers clear.
  const pending = state.transfers.some((t) => t.status === "Pending");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8_000);
    return () => clearTimeout(timer);
  }, [error]);

  const act = useMemo<Actions>(
    () => ({
      nudge: (userId, message, actor) => post("/api/nudges", { userId, message, actor }),
      payInvoice: (invoiceId) => post(`/api/invoices/${encodeURIComponent(invoiceId)}/pay`),
      setValidation: (woId, validation, forSubmission) => post(wo(woId, "validation"), { validation, forSubmission }),
      approveWorkOrder: (woId) => post(wo(woId, "approve")),
      requestChanges: (woId) => post(wo(woId, "request-changes")),
      submitInvoice: (woId, items, photos, invoiceNumber) => post(wo(woId, "submit"), { items, photos, invoiceNumber }),
      attachDocument: (woId, invoice) => post(wo(woId, "attach"), { invoice }),
      updateJob: (woId, status, photo) => post(wo(woId, "update"), { status, photo }),
      reportIssue: (tenantId, text) => post("/api/issues", { tenantId, text }),
      // A fresh key per click; the server pays at most once per key.
      disburseOwner: (ownerId) => post(`/api/owners/${encodeURIComponent(ownerId)}/disburse`, {}, { "Idempotency-Key": crypto.randomUUID() }),
      rate: (by, subject, stars, comment, ref) => post("/api/ratings", { by, subject, stars, comment, ref }),
      importRows: (rows, source) => post("/api/onboarding/import", { rows, source }),
      connectBank: (bank) => post("/api/onboarding/bank", { bank }),
      invite: (emails) => post("/api/onboarding/invite", { emails }),
      finishOnboarding: () => post("/api/onboarding/finish"),
      reset: () => post("/api/demo/reset"),
    }),
    [post],
  );

  return (
    <Ctx.Provider value={{ state, act, busy: inFlight > 0 }}>
      {children}
      {error && (
        <div role="alert" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-start gap-3 rounded-2xl bg-[#1C1917] px-4 py-3 text-sm text-[#FBF9F4] shadow-lg">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-[#FBF9F4]/70 underline underline-offset-4 hover:text-[#FBF9F4]">
            Dismiss
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useDemo() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDemo must be used inside DemoProvider");
  return ctx;
}
