import type { DemoState, WorkOrder } from "./types";

export const userName = (s: DemoState, id: string) => s.users.find((u) => u.id === id)?.name ?? id;
export const propName = (s: DemoState, id: string) => s.properties.find((p) => p.id === id)?.name ?? id;
export const vendorName = (s: DemoState, id: string) =>
  id === "in-house" ? "In-house maintenance" : s.vendors.find((v) => v.id === id)?.company ?? id;

// A job still needs work while it is not finished (paid, payment in flight, or completed in-house).
export const isOpenWorkOrder = (w: WorkOrder) => !["Payment pending", "Paid", "Completed"].includes(w.status);
// Identifies the exact invoice a validation was run on.
export const submissionKey = (w: WorkOrder) => JSON.stringify(w.submission ?? null);

export const isDoneWorkOrder = (w: WorkOrder) => ["Paid", "Completed"].includes(w.status);
