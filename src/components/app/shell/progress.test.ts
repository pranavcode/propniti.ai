import { describe, expect, it } from "vitest";
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
