import { afterEach, describe, expect, it, vi } from "vitest";
import { exitPersona } from "./persona";

afterEach(() => vi.unstubAllGlobals());

describe("exitPersona (Sign out of demo)", () => {
  it("asks the server to clear both cookies, then goes to the sign-in page", async () => {
    const writes: string[] = [];
    const assign = vi.fn();
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("document", { get cookie() { return "pn_as=grace"; }, set cookie(s: string) { writes.push(s); } });
    vi.stubGlobal("localStorage", { setItem: () => {} });
    vi.stubGlobal("window", { location: { assign } });
    vi.stubGlobal("fetch", fetch);
    await exitPersona();
    expect(fetch).toHaveBeenCalledWith("/api/session", { method: "DELETE" });
    expect(writes[0]).toMatch(/^pn_as=; .*Max-Age=0/);
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("still leaves when the request fails", async () => {
    const assign = vi.fn();
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal("window", { location: { assign } });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await exitPersona();
    expect(assign).toHaveBeenCalledWith("/login");
  });
});
