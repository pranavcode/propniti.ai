import type { DemoState } from "./types";

export const userName = (s: DemoState, id: string) => s.users.find((u) => u.id === id)?.name ?? id;
export const propName = (s: DemoState, id: string) => s.properties.find((p) => p.id === id)?.name ?? id;
export const vendorName = (s: DemoState, id: string) =>
  id === "in-house" ? "In-house maintenance" : s.vendors.find((v) => v.id === id)?.company ?? id;
