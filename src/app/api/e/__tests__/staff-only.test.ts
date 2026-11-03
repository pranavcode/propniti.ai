import { describe, expect, it, vi } from "vitest";

// Portal personas never render a staff page: the /app layout and the generic page both call
// requireStaff(), which sends them to their portal home before any data is read.
const jar = { persona: "resident" };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (k === "pn_as" ? { value: jar.persona } : undefined), has: () => true }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const render = async (path: string[]) => {
  const { default: Page } = await import("../../../(app)/app/[...path]/page");
  return Page({ params: Promise.resolve({ path }), searchParams: Promise.resolve({}) });
};

describe("staff pages", () => {
  it.each([["receivables", "delinquency"], ["properties"], ["residents", "res-p01-0001"]])("send a resident from /app/%s to the resident portal", async (...path) => {
    jar.persona = "resident";
    await expect(render(path)).rejects.toMatchObject({ to: "/portal/resident" });
  });

  it("send every portal persona to its own portal, and let staff through", async () => {
    const { requireStaff } = await import("@/auth/session");
    for (const [p, home] of [["owner", "/portal/owner"], ["vendor", "/portal/vendor"], ["applicant", "/portal/applicant"]]) {
      jar.persona = p;
      await expect(requireStaff()).rejects.toMatchObject({ to: home });
    }
    jar.persona = "marcus";
    expect((await requireStaff()).id).toBe("marcus");
  });
});
