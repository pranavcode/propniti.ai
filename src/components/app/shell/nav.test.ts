import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAS, type Persona } from "@/auth/personas";
import { REPORT_ROLES } from "@/extensions/accounting/reports/spec";

let persona: Persona;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }) }));
vi.mock("@/auth/session", () => ({ currentPersona: async () => persona }));

const { shellData } = await import("./data");
const staff = PERSONAS.filter((p) => !p.portal);
const hrefs = async (p: Persona) => {
  persona = p;
  return (await shellData()).nav.flatMap((s) => s.items.map((i) => i.href));
};

describe("sidebar for every staff persona", () => {
  beforeEach(() => { persona = staff[0]!; });

  it.each(staff.map((p) => [p.id, p] as const))("%s: Reports shows only when the reports page opens for the role", async (_, p) => {
    expect((await hrefs(p)).includes("/app/reports")).toBe(REPORT_ROLES.includes(p.role));
  });
});
