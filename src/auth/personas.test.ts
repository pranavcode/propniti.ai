import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERSONA, personaCookie, personaFromCookieHeader } from "./personas";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pn_as cookie", () => {
  it("is Secure on the server in production only", () => {
    expect(personaCookie("grace")).not.toContain("Secure");
    vi.stubEnv("NODE_ENV", "production");
    expect(personaCookie("grace")).toMatch(/^pn_as=grace; .*; Secure$/);
  });

  it("is Secure in the browser when the page is https", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    expect(personaCookie("grace")).toContain("; Secure");
    vi.stubGlobal("location", { protocol: "http:" });
    vi.stubEnv("NODE_ENV", "production");
    expect(personaCookie("grace")).not.toContain("Secure");
  });

  it("falls back to the default persona when the cookie is malformed", () => {
    expect(personaFromCookieHeader("pn_as=%E0%A4%A").id).toBe(DEFAULT_PERSONA);
    expect(personaFromCookieHeader("a=1; pn_as=%").id).toBe(DEFAULT_PERSONA);
    expect(personaFromCookieHeader("pn_as=grace").id).toBe("grace");
  });
});
