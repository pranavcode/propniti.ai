import { describe, expect, it } from "vitest";
import { cachedCounts, forgetInboxCounts } from "./counts";

const counts = (n: number) => ({ messages: n, needsReply: 0, approvals: 0, alerts: 0, unreadAlerts: 0, needsYou: n });

describe("inbox badge cache", () => {
  it("reuses a count for 30 s per workspace and persona, and reloads after a write in that workspace", async () => {
    let loads = 0;
    const load = async () => counts(++loads);
    expect((await cachedCounts("ws-a", "marcus", load, 0)).needsYou).toBe(1);
    expect((await cachedCounts("ws-a", "marcus", load, 29_000)).needsYou).toBe(1);
    expect((await cachedCounts("ws-a", "grace", load, 29_000)).needsYou).toBe(2);
    expect((await cachedCounts("ws-b", "marcus", load, 29_000)).needsYou).toBe(3);
    expect((await cachedCounts("ws-a", "marcus", load, 30_000)).needsYou).toBe(4);
    forgetInboxCounts("ws-a");
    expect((await cachedCounts("ws-a", "marcus", load, 30_001)).needsYou).toBe(5);
    expect((await cachedCounts("ws-a", "grace", load, 30_001)).needsYou).toBe(6);
    // Another workspace's entry is untouched.
    expect((await cachedCounts("ws-b", "marcus", load, 30_001)).needsYou).toBe(3);
  });

  it("loads fresh when asked, even inside the window, and stores it for the next cached read", async () => {
    let loads = 0;
    const load = async () => counts(++loads);
    expect((await cachedCounts("ws-c", "marcus", load, 0)).needsYou).toBe(1);
    expect((await cachedCounts("ws-c", "marcus", load, 1_000, true)).needsYou).toBe(2);
    expect((await cachedCounts("ws-c", "marcus", load, 2_000)).needsYou).toBe(2);
  });
});
