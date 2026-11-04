import { describe, expect, it, vi } from "vitest";
import { changesPage, navReducer, type NavEvent, type NavPhase } from "./progress";

const run = (events: NavEvent[], from: NavPhase = "idle") => events.reduce(navReducer, from);

describe("navigation progress", () => {
  it("shows only after the reveal delay, then finishes and settles", () => {
    expect(run(["start"])).toBe("waiting");
    expect(run(["start", "reveal"])).toBe("running");
    expect(run(["start", "reveal", "done"])).toBe("finishing");
    expect(run(["start", "reveal", "done", "settled"])).toBe("idle");
  });

  it("never shows a navigation that lands before the reveal delay", () => {
    expect(run(["start", "done"])).toBe("idle");
    expect(run(["start", "done", "reveal"])).toBe("idle");
  });

  it("restarts when a new navigation begins while the bar fades", () => {
    expect(run(["start", "reveal", "done", "start"])).toBe("running");
    expect(run(["start", "reveal", "done", "start", "done", "settled"])).toBe("idle");
  });

  it("ignores repeated starts and stray events", () => {
    expect(run(["start", "start", "reveal", "start"])).toBe("running");
    expect(run(["done", "settled", "reveal"])).toBe("idle");
  });

  it("starts only for a different page or search, not a hash jump or another site", () => {
    const at = { origin: "https://x.test", pathname: "/app/data-health", search: "" };
    expect(changesPage("?entity=bank_transactions", at)).toBe(true);
    expect(changesPage("/app/inbox", at)).toBe(true);
    expect(changesPage("/app/data-health", at)).toBe(false);
    expect(changesPage("#issues", at)).toBe(false);
    expect(changesPage("https://example.com/app/inbox", at)).toBe(false);
  });
});

describe("afterNav", () => {
  it("runs at once with no navigation in flight, and never on a later one after giving up", async () => {
    vi.useFakeTimers();
    const { afterNav, navDone, navStart } = await import("./progress");
    const now = vi.fn();
    afterNav(now);
    expect(now).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    navStart();
    afterNav(late);
    vi.advanceTimersByTime(15_000);
    navDone();
    vi.advanceTimersByTime(1_000);
    navStart();
    navDone();
    expect(late).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs when the current navigation commits", async () => {
    vi.useFakeTimers();
    const { afterNav, navDone, navStart } = await import("./progress");
    const fn = vi.fn();
    navStart();
    afterNav(fn);
    expect(fn).not.toHaveBeenCalled();
    navDone();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
  });
});
