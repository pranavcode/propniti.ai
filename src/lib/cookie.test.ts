import { afterEach, describe, expect, it, vi } from "vitest";
import { secureAttr } from "./cookie";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("secureAttr", () => {
  it("follows the page's protocol in the browser", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    expect(secureAttr()).toBe("; Secure");
    vi.stubGlobal("location", { protocol: "http:" });
    expect(secureAttr()).toBe("");
  });

  it("follows NODE_ENV on the server", () => {
    expect(secureAttr()).toBe("");
    vi.stubEnv("NODE_ENV", "production");
    expect(secureAttr()).toBe("; Secure");
  });
});
